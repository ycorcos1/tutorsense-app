// Placeholder for scoring and AI explanation pipeline.
// Will read /data/*.csv and write /public/scores.json and /public/explanations.json.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AggregatedMetrics, TutorKpis } from "../types/metrics";
import type {
  SessionRecord,
  SessionStatus,
  TutorRecord,
} from "../types/session";
import type {
  TutorAiInsights,
  TutorFeatureInput,
  AiThresholdRecommendation,
} from "../types/ai";
import { generateAiInsights } from "../lib/ai/ai_orchestrator.ts";

type ScoreFormulaVersion = "v1" | "v2";

const DEFAULT_FORMULA_VERSION: ScoreFormulaVersion =
  process.env.SCORE_FORMULA_VERSION === "v1" ? "v1" : "v2";

interface TutorOutput {
  tutor_id: string;
  name: string;
  subject: string;
  score: number;
  trend_7d: number[];
  kpis: TutorKpis;
  churn_risk: number; // percentage 0-100
  ai?: TutorAiInsights;
}

interface Explanation {
  why: string;
  suggested_action: string;
}

type ExplanationMap = Record<string, Explanation>;

const SESSION_STATUSES: SessionStatus[] = [
  "completed",
  "dropout",
  "rescheduled",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const OUTPUT_PATH = path.join(ROOT_DIR, "public", "scores.json");
const EXPLANATIONS_PATH = path.join(ROOT_DIR, "public", "explanations.json");

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface TopAtRiskEntry {
  tutor_id: string;
  name: string;
  score: number;
}

export interface PipelineSummary {
  processed: number;
  totalSessions: number;
  durationMs: number;
  generatedAt: string;
  formulaVersion: ScoreFormulaVersion;
  atRiskCount: number;
  aiGenerated: number;
  fallbackGenerated: number;
  explanationsGenerated: number;
  explanationsDurationMs: number;
  tokensIn: number;
  tokensOut: number;
  invalidTutorRows: number;
  invalidSessionRows: number;
  orphanedSessions: number;
  topAtRisk: TopAtRiskEntry[];
  aiProcessingMs: number;
  aiThresholds: AiThresholdRecommendation;
}

interface RunOptions {
  jsonSummary?: boolean;
  formulaVersion?: ScoreFormulaVersion;
}

export async function runScoringPipeline(
  formulaVersion: ScoreFormulaVersion = DEFAULT_FORMULA_VERSION
): Promise<PipelineSummary> {
  const start = Date.now();

  const tutorsPath = path.join(DATA_DIR, "tutors.csv");
  const sessionsPath = path.join(DATA_DIR, "sessions.csv");

  const { tutorMap, invalidTutorRows } = await loadTutors(tutorsPath);
  const {
    sessionsByTutor,
    invalidSessionRows,
    orphanedSessions,
    totalSessions,
    latestSessionDate,
  } = await loadSessions(sessionsPath, tutorMap);

  const trendDates = buildTrendDates(latestSessionDate);

  const tutorOutputs: TutorOutput[] = [];

  for (const tutor of tutorMap.values()) {
    const sessions = sessionsByTutor.get(tutor.tutorId) ?? [];
    const metrics = computeMetrics(sessions);
    const score = computeScore(metrics, formulaVersion);

    const trend = buildTrendForTutor(
      sessions,
      trendDates,
      score,
      formulaVersion
    );
    const churnRisk = computeChurnRisk(metrics, score, trend);

    tutorOutputs.push({
      tutor_id: tutor.tutorId,
      name: tutor.name,
      subject: tutor.subject,
      score,
      trend_7d: trend,
      kpis: {
        avg_rating:
          metrics.avgRating === null ? null : round(metrics.avgRating, 2),
        dropout_rate: round(metrics.dropoutRate, 4),
        tech_issue_rate: round(metrics.techIssueRate, 4),
        reschedule_rate: round(metrics.rescheduleRate, 4),
        sessions_count: metrics.sessionsCount,
        first_session_avg_rating:
          metrics.firstSessionAvgRating === null
            ? null
            : round(metrics.firstSessionAvgRating, 2),
        first_session_dropout_rate: round(metrics.firstSessionDropoutRate, 4),
        first_session_count: metrics.firstSessionCount,
        tutor_initiated_reschedule_rate: round(
          metrics.tutorInitiatedRescheduleRate,
          4
        ),
        no_show_rate: round(metrics.noShowRate, 4),
      },
      churn_risk: Number((churnRisk * 100).toFixed(1)),
    });
  }

  tutorOutputs.sort(
    (a, b) => a.score - b.score || a.tutor_id.localeCompare(b.tutor_id)
  );

  const featureInputs: TutorFeatureInput[] = tutorOutputs.map((tutor) => ({
    tutor_id: tutor.tutor_id,
    name: tutor.name,
    subject: tutor.subject,
    score: tutor.score,
    trend_7d: tutor.trend_7d,
    churn_risk: tutor.churn_risk,
    kpis: tutor.kpis,
  }));

  const aiStart = Date.now();
  const { insights: aiInsights, thresholdSummary } =
    generateAiInsights(featureInputs);
  for (const tutor of tutorOutputs) {
    const aiInsight = aiInsights.get(tutor.tutor_id);
    if (aiInsight) {
      tutor.ai = aiInsight;
    }
  }
  const aiDurationMs = Date.now() - aiStart;

  const generatedAt = new Date().toISOString();
  const atRiskTutors = selectAtRiskTutors(tutorOutputs);

  const explanationsStart = Date.now();
  // Generate explanations for all tutors, but prioritize AI for at-risk tutors
  const {
    map: explanationsMap,
    aiGenerated,
    fallbackGenerated,
    tokensIn,
    tokensOut,
  } = await generateExplanationsForAll(tutorOutputs, atRiskTutors);
  const explanationsDurationMs = Date.now() - explanationsStart;

  const output = {
    generated_at: generatedAt,
    formula_version: formulaVersion,
    ai_thresholds: thresholdSummary,
    tutors: tutorOutputs,
  };

  await writeJsonAtomic(OUTPUT_PATH, output);
  await writeJsonAtomic(EXPLANATIONS_PATH, explanationsMap);

  const durationMs = Date.now() - start;
  const topAtRisk = tutorOutputs
    .slice(0, 5)
    .map(({ tutor_id, name, score }) => ({ tutor_id, name, score }));

  return {
    processed: tutorOutputs.length,
    totalSessions,
    durationMs,
    generatedAt,
    formulaVersion,
    atRiskCount: atRiskTutors.length,
    aiGenerated,
    fallbackGenerated,
    explanationsGenerated: aiGenerated + fallbackGenerated,
    explanationsDurationMs,
    tokensIn,
    tokensOut,
    invalidTutorRows,
    invalidSessionRows,
    orphanedSessions,
    topAtRisk,
    aiProcessingMs: aiDurationMs,
    aiThresholds: thresholdSummary,
  };
}

export async function run(options: RunOptions = {}): Promise<void> {
  const formulaVersion = options.formulaVersion ?? DEFAULT_FORMULA_VERSION;
  const summary = await runScoringPipeline(formulaVersion);

  if (options.jsonSummary) {
    console.log(
      JSON.stringify(
        {
          success: true,
          processed: summary.processed,
          duration_ms: summary.durationMs,
          explanations_generated: summary.explanationsGenerated,
          formula_version: summary.formulaVersion,
          ai_processing_ms: summary.aiProcessingMs,
          ai_thresholds: summary.aiThresholds,
          top_at_risk: summary.topAtRisk,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`At-risk tutors selected: ${summary.atRiskCount}`);
  console.log(`Scoring formula version: ${summary.formulaVersion}`);

  console.log(
    `Explanations generated: total=${summary.explanationsGenerated} (ai=${summary.aiGenerated}, fallback=${summary.fallbackGenerated}),` +
      ` time=${summary.explanationsDurationMs}ms`
  );

  if (summary.tokensIn > 0 || summary.tokensOut > 0) {
    const estimatedCost =
      (summary.tokensIn / 1000) * 0.01 + (summary.tokensOut / 1000) * 0.03;
    console.log(
      `LLM tokens: input=${summary.tokensIn}, output=${
        summary.tokensOut
      }, estimated_cost=$${estimatedCost.toFixed(2)}`
    );
  }

  console.log(`AI insights processing: ${summary.aiProcessingMs}ms`);
  console.log(
    `Dynamic thresholds => score P35 ≤ ${summary.aiThresholds.scoreThreshold}, dropout P70 ≥ ${summary.aiThresholds.dropoutRateThreshold}%, no-show P70 ≥ ${summary.aiThresholds.noShowRateThreshold}%.`
  );

  console.log(
    `Scored ${summary.processed} tutor${
      summary.processed === 1 ? "" : "s"
    } from ${summary.totalSessions} session${
      summary.totalSessions === 1 ? "" : "s"
    } in ${summary.durationMs}ms.`
  );

  if (
    summary.invalidTutorRows > 0 ||
    summary.invalidSessionRows > 0 ||
    summary.orphanedSessions > 0
  ) {
    console.log(
      `Skipped ${summary.invalidTutorRows} invalid tutor rows, ${summary.invalidSessionRows} invalid session rows,` +
        ` and ${summary.orphanedSessions} session${
          summary.orphanedSessions === 1 ? "" : "s"
        } referencing unknown tutors.`
    );
  }
}

function parseCsv(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(",").map((value) => value.trim()))
    .filter((row) => row.length > 0);
}

async function loadTutors(
  filePath: string
): Promise<{ tutorMap: Map<string, TutorRecord>; invalidTutorRows: number }> {
  const content = await fs.readFile(filePath, "utf8");
  const rows = parseCsv(content);

  if (rows.length === 0) {
    throw new Error(`Tutor CSV at ${filePath} is empty.`);
  }

  const header = rows[0];
  const expectedHeader = ["tutor_id", "name", "subject", "hire_date"];
  if (!arraysEqual(header, expectedHeader)) {
    throw new Error(
      `Unexpected tutor CSV header. Expected ${expectedHeader.join(
        ","
      )} but received ${header.join(",")}.`
    );
  }

  const tutorMap = new Map<string, TutorRecord>();
  let invalidRows = 0;

  for (const row of rows.slice(1)) {
    if (row.length !== expectedHeader.length) {
      invalidRows += 1;
      continue;
    }

    const [tutorIdRaw, nameRaw, subjectRaw, hireDateRaw] = row;
    const tutorId = tutorIdRaw;
    const name = nameRaw;
    const subject = subjectRaw;
    const hireDate = hireDateRaw;

    if (!tutorId || !name || !subject || !isIsoDate(hireDate)) {
      invalidRows += 1;
      continue;
    }

    tutorMap.set(tutorId, {
      tutorId,
      name,
      subject,
      hireDate,
    });
  }

  return { tutorMap, invalidTutorRows: invalidRows };
}

async function loadSessions(
  filePath: string,
  tutorMap: Map<string, TutorRecord>
): Promise<{
  sessionsByTutor: Map<string, SessionRecord[]>;
  invalidSessionRows: number;
  orphanedSessions: number;
  totalSessions: number;
  latestSessionDate: Date | null;
}> {
  const content = await fs.readFile(filePath, "utf8");
  const rows = parseCsv(content);

  if (rows.length === 0) {
    throw new Error(`Session CSV at ${filePath} is empty.`);
  }

  const header = rows[0];
  const baseHeader = [
    "session_id",
    "tutor_id",
    "date",
    "duration_minutes",
    "rating",
    "status",
    "has_tech_issue",
  ];
  const optionalHeaderSet = new Set([
    "is_first_session",
    "reschedule_initiator",
    "no_show",
  ]);

  const baseMatches = baseHeader.every(
    (column, index) => header[index] === column
  );

  if (!baseMatches) {
    throw new Error(
      `Unexpected session CSV header. Expected prefix ${baseHeader.join(
        ","
      )} but received ${header.join(",")}.`
    );
  }

  for (let index = baseHeader.length; index < header.length; index += 1) {
    if (!optionalHeaderSet.has(header[index])) {
      throw new Error(
        `Unexpected session CSV column "${header[index]}" in ${filePath}.`
      );
    }
  }

  const isFirstSessionIndex = header.indexOf("is_first_session");
  const rescheduleInitiatorIndex = header.indexOf("reschedule_initiator");
  const noShowIndex = header.indexOf("no_show");

  const sessionsByTutor = new Map<string, SessionRecord[]>();
  let invalidRows = 0;
  let orphanedSessions = 0;
  let totalSessions = 0;
  let latestSessionDate: Date | null = null;

  for (const row of rows.slice(1)) {
    if (row.length < baseHeader.length || row.length !== header.length) {
      invalidRows += 1;
      continue;
    }

    const [
      sessionId,
      tutorId,
      dateRaw,
      durationRaw,
      ratingRaw,
      statusRaw,
      techIssueRaw,
    ] = row;

    if (
      !sessionId ||
      !tutorId ||
      !dateRaw ||
      !durationRaw ||
      !statusRaw ||
      !techIssueRaw
    ) {
      invalidRows += 1;
      continue;
    }

    const status = statusRaw as SessionStatus;
    if (!SESSION_STATUSES.includes(status)) {
      invalidRows += 1;
      continue;
    }

    const hasTechIssue = parseBoolean(techIssueRaw);
    if (hasTechIssue === null) {
      invalidRows += 1;
      continue;
    }

    const durationMinutes = Number.parseInt(durationRaw, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      invalidRows += 1;
      continue;
    }

    const date = dateRaw;
    if (!isIsoDate(date)) {
      invalidRows += 1;
      continue;
    }

    const sessionDate = parseIsoDate(date);
    if (!sessionDate) {
      invalidRows += 1;
      continue;
    }

    const rating = ratingRaw === "" ? null : Number.parseFloat(ratingRaw);
    if (
      rating !== null &&
      (!Number.isFinite(rating) || rating < 1 || rating > 5)
    ) {
      invalidRows += 1;
      continue;
    }

    if (!tutorMap.has(tutorId)) {
      orphanedSessions += 1;
      continue;
    }

    let isFirstSession = false;
    if (isFirstSessionIndex >= 0) {
      const raw = row[isFirstSessionIndex] ?? "";
      if (raw !== "") {
        const parsed = parseBoolean(raw);
        if (parsed === null) {
          invalidRows += 1;
          continue;
        }
        isFirstSession = parsed;
      }
    }

    let rescheduleInitiator: SessionRecord["rescheduleInitiator"] = null;
    if (rescheduleInitiatorIndex >= 0) {
      const raw = (row[rescheduleInitiatorIndex] ?? "").trim();
      if (raw !== "") {
        if (raw === "tutor" || raw === "student") {
          rescheduleInitiator = raw;
        } else {
          invalidRows += 1;
          continue;
        }
      }
    }

    let noShow = false;
    if (noShowIndex >= 0) {
      const raw = row[noShowIndex] ?? "";
      if (raw !== "") {
        const parsed = parseBoolean(raw);
        if (parsed === null) {
          invalidRows += 1;
          continue;
        }
        noShow = parsed;
      }
    }

    const session: SessionRecord = {
      sessionId,
      tutorId,
      date,
      durationMinutes,
      rating,
      status,
      hasTechIssue,
      isFirstSession,
      rescheduleInitiator,
      noShow,
    };

    const list = sessionsByTutor.get(tutorId);
    if (list) {
      list.push(session);
    } else {
      sessionsByTutor.set(tutorId, [session]);
    }

    totalSessions += 1;

    if (!latestSessionDate || sessionDate > latestSessionDate) {
      latestSessionDate = sessionDate;
    }
  }

  return {
    sessionsByTutor,
    invalidSessionRows: invalidRows,
    orphanedSessions,
    totalSessions,
    latestSessionDate,
  };
}

function computeMetrics(sessions: SessionRecord[]): AggregatedMetrics {
  if (sessions.length === 0) {
    return {
      avgRating: null,
      dropoutRate: 0,
      techIssueRate: 0,
      rescheduleRate: 0,
      sessionsCount: 0,
      firstSessionAvgRating: null,
      firstSessionDropoutRate: 0,
      firstSessionCount: 0,
      tutorInitiatedRescheduleRate: 0,
      tutorInitiatedRescheduleCount: 0,
      noShowRate: 0,
      noShowCount: 0,
    };
  }

  let ratingSum = 0;
  let ratingCount = 0;
  let dropouts = 0;
  let techIssues = 0;
  let reschedules = 0;
  let tutorInitiatedReschedules = 0;
  let noShowCount = 0;

  let firstSessionRatingSum = 0;
  let firstSessionRatingCount = 0;
  let firstSessionDropouts = 0;
  let firstSessionCount = 0;

  for (const session of sessions) {
    if (session.rating !== null) {
      ratingSum += session.rating;
      ratingCount += 1;
    }
    if (session.status === "dropout") {
      dropouts += 1;
      if (session.isFirstSession) {
        firstSessionDropouts += 1;
      }
    } else if (session.status === "rescheduled") {
      reschedules += 1;
      if (session.rescheduleInitiator === "tutor") {
        tutorInitiatedReschedules += 1;
      }
    }
    if (session.hasTechIssue) {
      techIssues += 1;
    }
    if (session.noShow) {
      noShowCount += 1;
    }
    if (session.isFirstSession) {
      firstSessionCount += 1;
      if (session.rating !== null) {
        firstSessionRatingSum += session.rating;
        firstSessionRatingCount += 1;
      }
    }
  }

  const total = sessions.length;
  const firstSessionAvgRating =
    firstSessionRatingCount > 0
      ? firstSessionRatingSum / firstSessionRatingCount
      : null;

  return {
    avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
    dropoutRate: total > 0 ? dropouts / total : 0,
    techIssueRate: total > 0 ? techIssues / total : 0,
    rescheduleRate: total > 0 ? reschedules / total : 0,
    sessionsCount: total,
    firstSessionAvgRating,
    firstSessionDropoutRate:
      firstSessionCount > 0 ? firstSessionDropouts / firstSessionCount : 0,
    firstSessionCount,
    tutorInitiatedRescheduleRate:
      reschedules > 0 ? tutorInitiatedReschedules / reschedules : 0,
    tutorInitiatedRescheduleCount: tutorInitiatedReschedules,
    noShowRate: total > 0 ? noShowCount / total : 0,
    noShowCount,
  };
}

function computeScore(
  metrics: AggregatedMetrics,
  version: ScoreFormulaVersion
): number {
  if (version === "v1") {
    return computeScoreV1(metrics);
  }
  return computeScoreV2(metrics);
}

function computeScoreV1(metrics: AggregatedMetrics): number {
  const { avgRating, dropoutRate, techIssueRate, rescheduleRate } = metrics;

  const ratingForPenalty = avgRating ?? 5;

  const rawScore =
    100 -
    (dropoutRate * 40 +
      techIssueRate * 30 +
      rescheduleRate * 20 +
      (5 - ratingForPenalty) * 10);

  return clampScore(Math.round(rawScore));
}

function computeScoreV2(metrics: AggregatedMetrics): number {
  const avgRating = metrics.avgRating ?? 5;
  const firstSessionRating =
    metrics.firstSessionAvgRating ?? metrics.avgRating ?? 5;

  const dropoutPenalty = metrics.dropoutRate * 30;
  const firstSessionDropoutPenalty =
    (metrics.firstSessionCount > 0 ? 35 : 20) * metrics.firstSessionDropoutRate;
  const techPenalty = metrics.techIssueRate * 18;
  const reschedulePenalty = metrics.rescheduleRate * 12;
  const tutorReschedulePenalty = metrics.tutorInitiatedRescheduleRate * 20;
  const noShowPenalty = metrics.noShowRate * 28;
  const ratingPenalty = (5 - avgRating) * 12;
  const firstSessionRatingPenalty = Math.max(0, 4.5 - firstSessionRating) * 8;
  const volumePenalty =
    metrics.sessionsCount < 5 ? 4 : metrics.sessionsCount < 10 ? 2 : 0;

  const penaltySum =
    dropoutPenalty +
    firstSessionDropoutPenalty +
    techPenalty +
    reschedulePenalty +
    tutorReschedulePenalty +
    noShowPenalty +
    ratingPenalty +
    firstSessionRatingPenalty +
    volumePenalty;

  const rawScore = 100 - penaltySum;
  return clampScore(Math.round(rawScore));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function computeChurnRisk(
  metrics: AggregatedMetrics,
  score: number,
  trend: number[]
): number {
  let risk =
    metrics.dropoutRate * 0.4 +
    metrics.noShowRate * 0.3 +
    metrics.tutorInitiatedRescheduleRate * 0.2 +
    metrics.firstSessionDropoutRate * 0.1;

  if (
    metrics.firstSessionAvgRating !== null &&
    metrics.firstSessionAvgRating < 3.0
  ) {
    risk += 0.05;
  }

  if (score < 50) {
    risk += 0.12;
  } else if (score < 60) {
    risk += 0.08;
  } else if (score < 70) {
    risk += 0.04;
  }

  if (trend.length >= 2) {
    const trendDelta = trend[trend.length - 1] - trend[0];
    if (trendDelta < -15) {
      risk += 0.07;
    } else if (trendDelta < -8) {
      risk += 0.04;
    } else if (trendDelta > 5) {
      risk -= 0.03;
    }
  }

  return clamp01(risk);
}

function smoothTrend(trend: number[], windowSize: number = 3): number[] {
  if (trend.length === 0) {
    return [];
  }
  if (trend.length === 1) {
    return trend;
  }

  const smoothed: number[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < trend.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(trend.length, i + halfWindow + 1);
    const window = trend.slice(start, end);
    const sum = window.reduce((acc, val) => acc + val, 0);
    const avg = sum / window.length;
    smoothed.push(Math.round(avg));
  }

  return smoothed;
}

function buildTrendForTutor(
  sessions: SessionRecord[],
  dates: string[],
  fallbackScore: number,
  formulaVersion: ScoreFormulaVersion
): number[] {
  const sessionsByDay = new Map<string, SessionRecord[]>();
  for (const session of sessions) {
    const list = sessionsByDay.get(session.date);
    if (list) {
      list.push(session);
    } else {
      sessionsByDay.set(session.date, [session]);
    }
  }

  const trend: number[] = [];
  let lastScore = fallbackScore;

  for (const date of dates) {
    const dailySessions = sessionsByDay.get(date);
    if (dailySessions && dailySessions.length > 0) {
      const metrics = computeMetrics(dailySessions);
      const score = computeScore(metrics, formulaVersion);
      trend.push(score);
      lastScore = score;
    } else {
      trend.push(lastScore);
    }
  }

  // Apply smoothing to reduce volatility from daily score fluctuations
  return smoothTrend(trend, 3);
}

function selectAtRiskTutors(tutors: TutorOutput[]): TutorOutput[] {
  if (tutors.length === 0) {
    return [];
  }

  const below60 = tutors.filter((tutor) => tutor.score < 60);
  const bottomCount = Math.max(1, Math.floor(tutors.length * 0.2));
  const bottom20 = tutors.slice(0, bottomCount);

  let selected: TutorOutput[];

  if (below60.length < bottom20.length) {
    selected = below60;
  } else if (bottom20.length < below60.length) {
    selected = bottom20;
  } else {
    const belowMin =
      below60.length > 0 ? below60[0].score : Number.POSITIVE_INFINITY;
    const bottomMin =
      bottom20.length > 0 ? bottom20[0].score : Number.POSITIVE_INFINITY;
    selected = belowMin <= bottomMin ? below60 : bottom20;
  }

  const ordered = [...selected].sort(
    (a, b) => a.score - b.score || a.tutor_id.localeCompare(b.tutor_id)
  );
  return ordered.slice(0, 50);
}

function buildFallbackExplanation(tutor: TutorOutput): Explanation {
  const {
    avg_rating,
    dropout_rate,
    tech_issue_rate,
    reschedule_rate,
    sessions_count,
    first_session_avg_rating,
    first_session_dropout_rate,
    first_session_count,
    tutor_initiated_reschedule_rate,
    no_show_rate,
  } = tutor.kpis;
  const churnRisk = tutor.churn_risk;

  // Handle tutors with scores >= 80 (green - good performers)
  if (tutor.score >= 80) {
    const strengths: string[] = [];
    if (dropout_rate < 0.1) {
      strengths.push("low dropout rate");
    }
    if (tech_issue_rate < 0.1) {
      strengths.push("minimal tech issues");
    }
    if (avg_rating !== null && avg_rating >= 4.0) {
      strengths.push(`strong ratings (${avg_rating.toFixed(1)})`);
    }
    if (reschedule_rate < 0.1) {
      strengths.push("good scheduling");
    }
    if (
      first_session_count > 0 &&
      first_session_avg_rating !== null &&
      first_session_avg_rating >= 4.0
    ) {
      strengths.push(
        `great first session experience (${first_session_avg_rating.toFixed(
          1
        )})`
      );
    }
    if (first_session_count > 0 && first_session_dropout_rate <= 0.1) {
      strengths.push("strong first session retention");
    }
    if (tutor_initiated_reschedule_rate < 0.2) {
      strengths.push("reliable scheduling discipline");
    }
    if (no_show_rate < 0.05) {
      strengths.push("excellent attendance (few no-shows)");
    }

    let why =
      strengths.length > 0
        ? `Score ${tutor.score} reflects ${strengths.join(
            ", "
          )} over the last period.`
        : `Score ${tutor.score} indicates solid performance across key metrics.`;
    if (churnRisk <= 30) {
      why += ` Churn risk remains low at ${churnRisk.toFixed(1)}%.`;
    } else if (churnRisk > 40) {
      why += ` However, churn risk has risen to ${churnRisk.toFixed(
        1
      )}%, monitor retention.`;
    }

    let suggestedAction =
      "Continue current practices and maintain performance standards.";
    if (avg_rating !== null && avg_rating >= 4.5) {
      suggestedAction = "Consider sharing best practices with other tutors.";
    }
    if (sessions_count > 20) {
      suggestedAction =
        "Maintain high engagement and consider mentoring opportunities.";
    }
    if (churnRisk > 50) {
      suggestedAction =
        "Maintain performance but run a churn-prevention audit and proactive outreach.";
    }

    return {
      why,
      suggested_action: suggestedAction,
    };
  }

  // Handle tutors with scores 60-80 (yellow - moderate performance)
  if (tutor.score >= 60 && tutor.score < 80) {
    const issues: string[] = [];
    const strengths: string[] = [];

    if (dropout_rate > 0.15) {
      issues.push(`${Math.round(dropout_rate * 100)}% dropout rate`);
    } else if (dropout_rate < 0.1) {
      strengths.push(`low ${Math.round(dropout_rate * 100)}% dropout rate`);
    }

    if (tech_issue_rate > 0.15) {
      issues.push(`${Math.round(tech_issue_rate * 100)}% tech issue rate`);
    } else if (tech_issue_rate < 0.1) {
      strengths.push(
        `minimal ${Math.round(tech_issue_rate * 100)}% tech issues`
      );
    }

    if (avg_rating !== null) {
      if (avg_rating < 3.5) {
        issues.push(`below-average ${avg_rating.toFixed(1)} star rating`);
      } else if (avg_rating >= 4.0) {
        strengths.push(`strong ${avg_rating.toFixed(1)} star rating`);
      }
    }

    if (reschedule_rate > 0.15) {
      issues.push(`${Math.round(reschedule_rate * 100)}% reschedule rate`);
    } else if (reschedule_rate < 0.1) {
      strengths.push(
        `good scheduling with ${Math.round(reschedule_rate * 100)}% reschedules`
      );
    }

    if (
      first_session_count > 0 &&
      first_session_avg_rating !== null &&
      first_session_avg_rating >= 4.0
    ) {
      strengths.push(
        `first session rating ${first_session_avg_rating.toFixed(1)}`
      );
    } else if (
      first_session_count > 0 &&
      first_session_avg_rating !== null &&
      first_session_avg_rating < 3.5
    ) {
      issues.push(
        `first session ratings ${first_session_avg_rating.toFixed(1)}`
      );
    }

    if (first_session_count > 0 && first_session_dropout_rate > 0.2) {
      issues.push(
        `first session dropouts ${Math.round(
          first_session_dropout_rate * 100
        )}%`
      );
    }

    if (tutor_initiated_reschedule_rate > 0.5) {
      issues.push(
        `tutor reschedules ${Math.round(
          tutor_initiated_reschedule_rate * 100
        )}%`
      );
    } else if (tutor_initiated_reschedule_rate < 0.2) {
      strengths.push(
        `low tutor reschedules ${Math.round(
          tutor_initiated_reschedule_rate * 100
        )}%`
      );
    }

    if (no_show_rate > 0.1) {
      issues.push(`no-shows ${Math.round(no_show_rate * 100)}%`);
    } else if (no_show_rate < 0.05) {
      strengths.push(
        `reliable attendance (${Math.round(no_show_rate * 100)}% no-shows)`
      );
    }

    let why = `Score ${tutor.score} indicates moderate performance. `;
    if (issues.length > 0 && strengths.length > 0) {
      why += `While showing ${strengths.join(
        " and "
      )}, the tutor faces challenges with ${issues.join(
        ", "
      )} over ${sessions_count} sessions.`;
    } else if (issues.length > 0) {
      why += `Performance is impacted by ${issues.join(
        ", "
      )} across ${sessions_count} sessions in the last period.`;
    } else if (strengths.length > 0) {
      why += `The tutor demonstrates ${strengths.join(
        " and "
      )}, but overall score suggests room for improvement in consistency or other metrics.`;
    } else {
      why += `Mixed performance across key metrics with ${sessions_count} sessions completed.`;
    }
    why += ` Current churn risk is ${churnRisk.toFixed(1)}%.`;

    let suggestedAction = "";
    const actionPriority: string[] = [];

    if (dropout_rate > 0.2) {
      actionPriority.push(
        `Focus on reducing the ${Math.round(
          dropout_rate * 100
        )}% dropout rate by improving session engagement and follow-up communication`
      );
    } else if (dropout_rate > 0.15) {
      actionPriority.push(
        `Address the ${Math.round(
          dropout_rate * 100
        )}% dropout rate through better expectation-setting`
      );
    }

    if (tech_issue_rate > 0.2) {
      actionPriority.push(
        `Resolve technical issues affecting ${Math.round(
          tech_issue_rate * 100
        )}% of sessions with equipment check and troubleshooting training`
      );
    } else if (tech_issue_rate > 0.15) {
      actionPriority.push(
        `Reduce tech issues (${Math.round(
          tech_issue_rate * 100
        )}%) through proactive equipment maintenance`
      );
    }

    if (avg_rating !== null && avg_rating < 3.5) {
      actionPriority.push(
        `Improve the ${avg_rating.toFixed(
          1
        )} star rating through quality review, shadowing, and feedback incorporation`
      );
    }

    if (reschedule_rate > 0.2) {
      actionPriority.push(
        `Strengthen scheduling discipline to reduce the ${Math.round(
          reschedule_rate * 100
        )}% reschedule rate`
      );
    } else if (reschedule_rate > 0.15) {
      actionPriority.push(
        `Improve scheduling reliability (currently ${Math.round(
          reschedule_rate * 100
        )}% reschedules)`
      );
    }

    if (sessions_count < 10) {
      actionPriority.push(
        `Increase session volume (currently ${sessions_count} sessions) to build consistency and experience`
      );
    }

    if (
      first_session_count > 0 &&
      first_session_avg_rating !== null &&
      first_session_avg_rating < 3.5
    ) {
      actionPriority.push(
        "Improve first-session delivery: rehearse onboarding flow and focus on rapport in the first 10 minutes"
      );
    }

    if (first_session_count > 0 && first_session_dropout_rate > 0.2) {
      actionPriority.push(
        `Reduce first-session dropouts (${Math.round(
          first_session_dropout_rate * 100
        )}%): set expectations upfront and schedule proactive follow-ups`
      );
    }

    if (tutor_initiated_reschedule_rate > 0.5) {
      actionPriority.push(
        `Address tutor-driven reschedules (${Math.round(
          tutor_initiated_reschedule_rate * 100
        )}%): audit calendar management and implement scheduling guardrails`
      );
    }

    if (no_show_rate > 0.1) {
      actionPriority.push(
        `Curb no-shows (${Math.round(
          no_show_rate * 100
        )}%): introduce reminders and accountability touchpoints`
      );
    }

    if (churnRisk > 60) {
      actionPriority.unshift(
        `Launch churn prevention plan: dedicate coaching sessions and retention incentives (risk ${churnRisk.toFixed(
          1
        )}%).`
      );
    } else if (churnRisk > 40) {
      actionPriority.push(
        `Monitor churn indicators weekly (risk ${churnRisk.toFixed(
          1
        )}%) and intervene proactively.`
      );
    }

    if (actionPriority.length > 0) {
      suggestedAction = actionPriority[0] + ".";
      if (actionPriority.length > 1) {
        suggestedAction += ` Additionally, ${actionPriority[1].toLowerCase()}.`;
      }
    } else {
      suggestedAction =
        "Review recent session patterns and provide targeted coaching to address specific performance gaps. Consider pairing with a mentor for structured improvement.";
    }

    return {
      why,
      suggested_action: suggestedAction,
    };
  }

  // Handle tutors with scores < 60 (red - at-risk)
  const drivers: string[] = [];
  const severity: string[] = [];

  if (dropout_rate > 0.25) {
    drivers.push(`critical ${Math.round(dropout_rate * 100)}% dropout rate`);
    severity.push("high");
  } else if (dropout_rate > 0.15) {
    drivers.push(`elevated ${Math.round(dropout_rate * 100)}% dropout rate`);
    severity.push("moderate");
  }

  if (tech_issue_rate > 0.25) {
    drivers.push(
      `severe ${Math.round(tech_issue_rate * 100)}% tech issue rate`
    );
    severity.push("high");
  } else if (tech_issue_rate > 0.15) {
    drivers.push(
      `significant ${Math.round(tech_issue_rate * 100)}% tech issue rate`
    );
    severity.push("moderate");
  }

  if (avg_rating !== null) {
    if (avg_rating < 2.5) {
      drivers.push(`very low ${avg_rating.toFixed(1)} star rating`);
      severity.push("high");
    } else if (avg_rating < 3.5) {
      drivers.push(`below-average ${avg_rating.toFixed(1)} star rating`);
      severity.push("moderate");
    }
  }

  if (reschedule_rate > 0.25) {
    drivers.push(
      `excessive ${Math.round(reschedule_rate * 100)}% reschedule rate`
    );
    severity.push("high");
  } else if (reschedule_rate > 0.15) {
    drivers.push(`high ${Math.round(reschedule_rate * 100)}% reschedule rate`);
    severity.push("moderate");
  }

  if (
    first_session_count > 0 &&
    first_session_avg_rating !== null &&
    first_session_avg_rating < 3.2
  ) {
    drivers.push(
      `first session ratings ${first_session_avg_rating.toFixed(1)}`
    );
    severity.push("moderate");
  }
  if (first_session_count > 0 && first_session_dropout_rate > 0.25) {
    drivers.push(
      `first session dropouts ${Math.round(first_session_dropout_rate * 100)}%`
    );
    severity.push("high");
  }

  if (tutor_initiated_reschedule_rate > 0.6) {
    drivers.push(
      `tutor reschedules ${Math.round(tutor_initiated_reschedule_rate * 100)}%`
    );
    severity.push("moderate");
  }

  if (no_show_rate > 0.12) {
    drivers.push(`no-shows ${Math.round(no_show_rate * 100)}%`);
    severity.push(no_show_rate > 0.2 ? "high" : "moderate");
  }

  const isCritical = severity.includes("high") || tutor.score < 50;
  const sessionContext =
    sessions_count < 5
      ? `with only ${sessions_count} sessions`
      : `across ${sessions_count} sessions`;

  let why = "";
  if (drivers.length > 0) {
    why = `Score ${tutor.score} reflects ${
      isCritical ? "critical" : "significant"
    } performance issues ${sessionContext}. `;
    why += `The tutor is struggling with ${drivers.join(
      ", "
    )} in the last period. `;
    if (sessions_count < 5) {
      why += `Limited session volume (${sessions_count} sessions) may also be contributing to the low score.`;
    } else {
      why += `These patterns across ${sessions_count} sessions indicate systemic challenges requiring immediate attention.`;
    }
  } else {
    why = `Score ${tutor.score} indicates poor performance ${sessionContext} with mixed KPI results. `;
    why += `While no single metric is severely problematic, the combination of factors suggests the tutor needs comprehensive support and coaching intervention.`;
  }
  why += ` Churn risk is ${churnRisk.toFixed(1)}%.`;

  let suggestedAction = "";
  const actionSteps: string[] = [];

  if (tech_issue_rate > 0.2) {
    actionSteps.push(
      `Immediate technical intervention: Conduct equipment audit and provide troubleshooting training to address the ${Math.round(
        tech_issue_rate * 100
      )}% tech issue rate`
    );
  } else if (tech_issue_rate > 0.15) {
    actionSteps.push(
      `Technical support: Schedule equipment check and troubleshooting refresher for the ${Math.round(
        tech_issue_rate * 100
      )}% tech issue rate`
    );
  }

  if (dropout_rate > 0.25) {
    actionSteps.push(
      `Urgent dropout reduction: Implement structured coaching on engagement strategies and follow-up protocols to address the ${Math.round(
        dropout_rate * 100
      )}% dropout rate`
    );
  } else if (dropout_rate > 0.2) {
    actionSteps.push(
      `Dropout intervention: Coach on expectation-setting, session preparation, and proactive communication to reduce the ${Math.round(
        dropout_rate * 100
      )}% dropout rate`
    );
  } else if (dropout_rate > 0.15) {
    actionSteps.push(
      `Address dropouts: Provide coaching on engagement and follow-up to improve the ${Math.round(
        dropout_rate * 100
      )}% dropout rate`
    );
  }

  if (avg_rating !== null && avg_rating < 2.5) {
    actionSteps.push(
      `Quality crisis management: Schedule immediate quality review, shadowing session, and structured feedback to improve the ${avg_rating.toFixed(
        1
      )} star rating`
    );
  } else if (avg_rating !== null && avg_rating < 3.0) {
    actionSteps.push(
      `Quality improvement: Conduct quality review and shadowing to boost the ${avg_rating.toFixed(
        1
      )} star rating through targeted feedback`
    );
  } else if (avg_rating !== null && avg_rating < 3.5) {
    actionSteps.push(
      `Rating improvement: Schedule quality review and incorporate feedback to enhance the ${avg_rating.toFixed(
        1
      )} star rating`
    );
  }

  if (reschedule_rate > 0.25) {
    actionSteps.push(
      `Scheduling discipline: Implement strict scheduling protocols and confirmation processes to address the ${Math.round(
        reschedule_rate * 100
      )}% reschedule rate`
    );
  } else if (reschedule_rate > 0.2) {
    actionSteps.push(
      `Scheduling improvement: Reinforce scheduling discipline and confirmation procedures to reduce the ${Math.round(
        reschedule_rate * 100
      )}% reschedule rate`
    );
  } else if (reschedule_rate > 0.15) {
    actionSteps.push(
      `Scheduling support: Provide guidance on scheduling reliability to improve the ${Math.round(
        reschedule_rate * 100
      )}% reschedule rate`
    );
  }

  if (
    first_session_count > 0 &&
    first_session_avg_rating !== null &&
    first_session_avg_rating < 3.2
  ) {
    actionSteps.push(
      "First-session triage: shadow the next onboarding, refine intro script, and supply a quality checklist"
    );
  }

  if (first_session_count > 0 && first_session_dropout_rate > 0.25) {
    actionSteps.push(
      `First-session retention plan: launch rapid follow-up and expectation-setting to reduce the ${Math.round(
        first_session_dropout_rate * 100
      )}% dropout rate`
    );
  }

  if (tutor_initiated_reschedule_rate > 0.6) {
    actionSteps.push(
      `Scheduling overhaul: enforce calendar guardrails to slash tutor-driven reschedules (${Math.round(
        tutor_initiated_reschedule_rate * 100
      )}%)`
    );
  }

  if (no_show_rate > 0.12) {
    actionSteps.push(
      `Attendance remediation: add reminder automation and accountability touchpoints to curb the ${Math.round(
        no_show_rate * 100
      )}% no-show rate`
    );
  }

  if (sessions_count < 5) {
    actionSteps.push(
      `Mentorship pairing: Assign a mentor for close review and support during the next sessions to build foundational skills`
    );
  } else if (sessions_count < 10 && tutor.score < 50) {
    actionSteps.push(
      `Structured mentorship: Pair with an experienced mentor for ongoing support and skill development`
    );
  }

  if (actionSteps.length > 0) {
    suggestedAction = actionSteps[0] + ".";
    if (actionSteps.length > 1) {
      suggestedAction += ` Additionally, ${actionSteps[1].toLowerCase()}.`;
    }
    if (actionSteps.length > 2) {
      suggestedAction += ` Finally, ${actionSteps[2].toLowerCase()}.`;
    }
  } else {
    suggestedAction = `Comprehensive review and coaching: Conduct a full performance review of ${sessions_count} sessions, identify root causes, and develop a structured improvement plan with regular check-ins.`;
  }

  return {
    why,
    suggested_action: suggestedAction,
  };
}

function buildPrompt(tutor: TutorOutput): { system: string; user: string } {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const avgRating =
    tutor.kpis.avg_rating === null ? "n/a" : tutor.kpis.avg_rating.toFixed(1);

  const system =
    "You are an analytics coach. Respond with concise, practical guidance. Output strict JSON.";

  const user = [
    `Tutor: ${tutor.name} (${tutor.subject})`,
    `Score: ${tutor.score}`,
    "KPIs (last 14 days):",
    `- Avg Rating: ${avgRating}`,
    `- Dropout: ${pct(tutor.kpis.dropout_rate)}`,
    `- Tech Issues: ${pct(tutor.kpis.tech_issue_rate)}`,
    `- Reschedules: ${pct(tutor.kpis.reschedule_rate)}`,
    `- Sessions: ${tutor.kpis.sessions_count}`,
    `- First Session Avg: ${
      tutor.kpis.first_session_avg_rating === null
        ? "n/a"
        : tutor.kpis.first_session_avg_rating.toFixed(1)
    } (${pct(tutor.kpis.first_session_dropout_rate)} dropouts)`,
    `- Tutor Reschedules: ${pct(tutor.kpis.tutor_initiated_reschedule_rate)}`,
    `- No-shows: ${pct(tutor.kpis.no_show_rate)}`,
    `- Churn Risk: ${tutor.churn_risk.toFixed(1)}%`,
    "",
    "Return strict JSON with two fields:",
    "{",
    '  "why": "one sentence explaining why the tutor is at risk (75 chars max)",',
    '  "suggested_action": "one concrete coaching step (125 chars max)"',
    "}",
  ].join("\n");

  return { system, user };
}

async function generateExplanationsForAll(
  allTutors: TutorOutput[],
  atRiskTutors: TutorOutput[]
): Promise<{
  map: ExplanationMap;
  aiGenerated: number;
  fallbackGenerated: number;
  tokensIn: number;
  tokensOut: number;
}> {
  const map: ExplanationMap = {};

  // Generate explanations for all tutors using fallback
  for (const tutor of allTutors) {
    map[tutor.tutor_id] = buildFallbackExplanation(tutor);
  }

  // Try to use AI for at-risk tutors if API key is available
  if (atRiskTutors.length === 0) {
    return {
      map,
      aiGenerated: 0,
      fallbackGenerated: allTutors.length,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return {
      map,
      aiGenerated: 0,
      fallbackGenerated: allTutors.length,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  let OpenAIConstructor: typeof import("openai").default;
  try {
    const module = await import("openai");
    OpenAIConstructor = module.default;
  } catch (error) {
    console.warn(
      "OpenAI SDK is not available, using fallback explanations.",
      error
    );
    return {
      map,
      aiGenerated: 0,
      fallbackGenerated: allTutors.length,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const client = new OpenAIConstructor({ apiKey });
  const concurrency = Math.min(4, atRiskTutors.length);
  let index = 0;
  let aiGenerated = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  async function processTutor(tutor: TutorOutput): Promise<void> {
    const { system, user } = buildPrompt(tutor);
    const schema = {
      name: "TutorExplanation",
      schema: {
        type: "object",
        properties: {
          why: { type: "string", maxLength: 200 },
          suggested_action: { type: "string", maxLength: 240 },
        },
        required: ["why", "suggested_action"],
        additionalProperties: false,
      },
      strict: true,
    } as const;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: system,
            },
            {
              role: "user",
              content: user,
            },
          ],
          response_format: { type: "json_object" },
        });

        const text = response.choices[0]?.message?.content ?? "";
        const parsed = JSON.parse(text) as Partial<Explanation>;
        const why = typeof parsed.why === "string" ? parsed.why.trim() : "";
        const suggestedAction =
          typeof parsed.suggested_action === "string"
            ? parsed.suggested_action.trim()
            : "";

        if (!why || !suggestedAction) {
          throw new Error("LLM response missing required fields");
        }

        map[tutor.tutor_id] = {
          why: why.slice(0, 240),
          suggested_action: suggestedAction.slice(0, 240),
        };
        aiGenerated += 1;
        tokensIn += response.usage?.prompt_tokens ?? 0;
        tokensOut += response.usage?.completion_tokens ?? 0;
        return;
      } catch (error) {
        if (attempt === 1) {
          // Fallback on second failure
          map[tutor.tutor_id] = buildFallbackExplanation(tutor);
        }
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i += 1) {
    workers.push(
      (async () => {
        while (true) {
          const currentIndex = index;
          index += 1;
          if (currentIndex >= atRiskTutors.length) {
            return;
          }
          const tutor = atRiskTutors[currentIndex];
          await processTutor(tutor);
        }
      })()
    );
  }

  await Promise.all(workers);

  return {
    map,
    aiGenerated,
    fallbackGenerated: allTutors.length - aiGenerated,
    tokensIn,
    tokensOut,
  };
}

async function generateExplanations(atRisk: TutorOutput[]): Promise<{
  map: ExplanationMap;
  aiGenerated: number;
  fallbackGenerated: number;
  tokensIn: number;
  tokensOut: number;
}> {
  const map: ExplanationMap = {};

  if (atRisk.length === 0) {
    return {
      map,
      aiGenerated: 0,
      fallbackGenerated: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    for (const tutor of atRisk) {
      map[tutor.tutor_id] = buildFallbackExplanation(tutor);
    }
    return {
      map,
      aiGenerated: 0,
      fallbackGenerated: atRisk.length,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  let OpenAIConstructor: typeof import("openai").default;
  try {
    const module = await import("openai");
    OpenAIConstructor = module.default;
  } catch (error) {
    console.warn(
      "OpenAI SDK is not available, using fallback explanations.",
      error
    );
    for (const tutor of atRisk) {
      map[tutor.tutor_id] = buildFallbackExplanation(tutor);
    }
    return {
      map,
      aiGenerated: 0,
      fallbackGenerated: atRisk.length,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const client = new OpenAIConstructor({ apiKey });
  const concurrency = Math.min(4, atRisk.length);
  let index = 0;
  let aiGenerated = 0;
  let fallbackGenerated = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  async function processTutor(tutor: TutorOutput): Promise<void> {
    const { system, user } = buildPrompt(tutor);
    const schema = {
      name: "TutorExplanation",
      schema: {
        type: "object",
        properties: {
          why: { type: "string", maxLength: 200 },
          suggested_action: { type: "string", maxLength: 240 },
        },
        required: ["why", "suggested_action"],
        additionalProperties: false,
      },
      strict: true,
    } as const;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: system,
            },
            {
              role: "user",
              content: user,
            },
          ],
          response_format: { type: "json_object" },
        });

        const text = response.choices[0]?.message?.content ?? "";
        const parsed = JSON.parse(text) as Partial<Explanation>;
        const why = typeof parsed.why === "string" ? parsed.why.trim() : "";
        const suggestedAction =
          typeof parsed.suggested_action === "string"
            ? parsed.suggested_action.trim()
            : "";

        if (!why || !suggestedAction) {
          throw new Error("LLM response missing required fields");
        }

        map[tutor.tutor_id] = {
          why: why.slice(0, 240),
          suggested_action: suggestedAction.slice(0, 240),
        };
        aiGenerated += 1;

        if (response.usage) {
          tokensIn += response.usage.prompt_tokens ?? 0;
          tokensOut += response.usage.completion_tokens ?? 0;
        }
        return;
      } catch (error) {
        if (attempt === 0) {
          console.warn(
            `Retrying explanation generation for ${tutor.tutor_id} due to error:`,
            error
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          console.warn(
            `Falling back to template for ${tutor.tutor_id} after repeated errors:`,
            error
          );
        }
      }
    }

    map[tutor.tutor_id] = buildFallbackExplanation(tutor);
    fallbackGenerated += 1;
  }

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = index;
      if (currentIndex >= atRisk.length) {
        break;
      }
      index += 1;
      const tutor = atRisk[currentIndex];
      await processTutor(tutor);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return { map, aiGenerated, fallbackGenerated, tokensIn, tokensOut };
}

function buildTrendDates(latestSessionDate: Date | null): string[] {
  const baseDate = latestSessionDate
    ? truncateToUTC(latestSessionDate)
    : truncateToUTC(new Date());
  const startDate = addDays(baseDate, -6);

  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const current = addDays(startDate, i);
    dates.push(formatDate(current));
  }
  return dates;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureParentDirectory(filePath);
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tempPath, filePath);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseIsoDate(value: string): Date | null {
  if (!isIsoDate(value)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function truncateToUTC(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * MILLISECONDS_PER_DAY);
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

if (import.meta.url === `file://${__filename}`) {
  const wantsJsonSummary = process.argv.includes("--json-summary");
  const formulaFlagEq = process.argv
    .find((arg) => arg.startsWith("--formula="))
    ?.split("=")[1];
  const formulaFlagIdx = process.argv.findIndex((arg) => arg === "--formula");
  const formulaFlagArg =
    formulaFlagIdx >= 0 ? process.argv[formulaFlagIdx + 1] : undefined;
  const requestedVersion = (formulaFlagEq || formulaFlagArg) as
    | ScoreFormulaVersion
    | undefined;
  const normalizedVersion: ScoreFormulaVersion | undefined =
    requestedVersion === "v1" || requestedVersion === "v2"
      ? requestedVersion
      : undefined;
  run({
    jsonSummary: wantsJsonSummary,
    formulaVersion: normalizedVersion,
  }).catch((error) => {
    console.error("Failed to score tutors:", error);
    process.exitCode = 1;
  });
}
