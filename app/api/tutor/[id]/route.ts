import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import type { AggregatedMetrics, TutorKpis } from "@/types/metrics";
import type { SessionRecord, SessionStatus } from "@/types/session";
import type { TutorAiInsights, AiThresholdRecommendation } from "@/types/ai";

export const revalidate = 0;

type KPIs = TutorKpis;

type ScoreFormulaVersion = "v1" | "v2";

type TutorSummary = {
  tutor_id: string;
  name: string;
  subject: string;
  score: number;
  trend_7d: number[];
  kpis: KPIs;
  churn_risk: number;
  formula_version?: string;
  ai?: TutorAiInsights;
};

type ScoresFile = {
  generated_at: string;
  formula_version?: string;
  ai_thresholds?: AiThresholdRecommendation;
  tutors: TutorSummary[];
};

type Explanation = {
  why: string;
  suggested_action: string;
};

type ExplanationMap = Record<string, Explanation>;

type TutorIdentity = {
  tutor_id: string;
  name: string;
  subject: string;
};

type DailyPoint = {
  date: string;
  score: number;
  kpis: KPIs;
};

type TutorDetailsResponse = {
  tutor_id: string;
  name: string;
  subject: string;
  summary: {
    score: number;
    trend_7d: number[];
    kpis: KPIs;
    churn_risk: number;
  };
  ai?: TutorAiInsights;
  ai_thresholds?: AiThresholdRecommendation | null;
  explanation?: Explanation;
  days: DailyPoint[];
  generated_at: string;
  formula_version: ScoreFormulaVersion;
};

type Params = {
  params: {
    id: string;
  };
};

const SESSION_STATUSES: SessionStatus[] = [
  "completed",
  "dropout",
  "rescheduled",
];

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(_request: Request, { params }: Params) {
  const tutorId = params.id?.trim();

  if (!tutorId) {
    return NextResponse.json(
      { error: "Tutor id is required" },
      { status: 400 }
    );
  }

  const baseDir = process.cwd();
  const scoresPath = path.join(baseDir, "public", "scores.json");
  const explanationsPath = path.join(baseDir, "public", "explanations.json");
  const tutorsPath = path.join(baseDir, "data", "tutors.csv");
  const sessionsPath = path.join(baseDir, "data", "sessions.csv");

  let scores: ScoresFile;
  try {
    scores = await readJson<ScoresFile>(scoresPath);
  } catch (error) {
    return serviceUnavailable(
      "Failed to load scores file",
      error instanceof Error ? error.message : String(error)
    );
  }

  const [explanations, tutorIdentityMap] = await Promise.all([
    readJson<ExplanationMap>(explanationsPath).catch(
      () => ({} as ExplanationMap)
    ),
    loadTutorIdentities(tutorsPath).catch(
      () => new Map<string, TutorIdentity>()
    ),
  ]);

  let sessionsResult;
  try {
    sessionsResult = await parseSessionsForTutor(sessionsPath, tutorId);
  } catch (error) {
    return serviceUnavailable(
      "Failed to load sessions data",
      error instanceof Error ? error.message : String(error)
    );
  }

  const summary = scores.tutors.find((tutor) => tutor.tutor_id === tutorId);

  if (!summary) {
    const fallbackIdentity = tutorIdentityMap.get(tutorId);
    const message = fallbackIdentity ? "Tutor not scored" : "Tutor not found";
    return NextResponse.json(
      { error: message, tutor_id: tutorId },
      { status: 404 }
    );
  }

  const identity = tutorIdentityMap.get(tutorId);

  const name = summary.name ?? identity?.name ?? tutorId;
  const subject = summary.subject ?? identity?.subject ?? "Unknown";
  const explanation = explanations[tutorId];

  const effectiveLatestDate =
    sessionsResult.latestDate ??
    extractDateFromTimestamp(scores.generated_at) ??
    getTodayDate();

  let dateRange: string[];
  try {
    dateRange = buildDateRange(effectiveLatestDate, 14);
  } catch (error) {
    return serviceUnavailable(
      "Failed to build date range",
      error instanceof Error ? error.message : String(error)
    );
  }

  const formulaVersion: ScoreFormulaVersion =
    scores.formula_version === "v1" ? "v1" : "v2";

  const days = buildDailySeries(
    sessionsResult.sessions,
    dateRange,
    summary.score,
    formulaVersion
  );

  const response: TutorDetailsResponse = {
    tutor_id: summary.tutor_id,
    name,
    subject,
    summary: {
      score: summary.score,
      trend_7d: summary.trend_7d,
      kpis: summary.kpis,
      churn_risk: summary.churn_risk,
    },
    ai: summary.ai,
    ai_thresholds: scores.ai_thresholds ?? null,
    ...(explanation ? { explanation } : {}),
    days,
    generated_at: scores.generated_at,
    formula_version: formulaVersion,
  };

  return NextResponse.json(response);
}

function serviceUnavailable(reason: string, details?: string) {
  return NextResponse.json(
    {
      error: reason,
      ...(details ? { details } : {}),
    },
    { status: 503 }
  );
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function loadTutorIdentities(
  filePath: string
): Promise<Map<string, TutorIdentity>> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = splitCsvLines(content);

  if (lines.length === 0) {
    throw new Error(`Tutor CSV at ${filePath} is empty`);
  }

  const header = splitCsvLine(lines[0]);
  const expectedHeader = ["tutor_id", "name", "subject", "hire_date"];
  if (!arraysEqual(header, expectedHeader)) {
    throw new Error(
      `Unexpected tutor CSV header. Expected ${expectedHeader.join(
        ","
      )} but received ${header.join(",")}`
    );
  }

  const map = new Map<string, TutorIdentity>();

  for (const line of lines.slice(1)) {
    if (!line) {
      continue;
    }
    const row = splitCsvLine(line);
    if (row.length !== expectedHeader.length) {
      continue;
    }

    const [tutorId, name, subject] = row;
    if (!tutorId || !name || !subject) {
      continue;
    }

    map.set(tutorId, {
      tutor_id: tutorId,
      name,
      subject,
    });
  }

  return map;
}

async function parseSessionsForTutor(
  filePath: string,
  tutorId: string
): Promise<{ sessions: SessionRecord[]; latestDate: string | null }> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = splitCsvLines(content);

  if (lines.length === 0) {
    throw new Error(`Session CSV at ${filePath} is empty`);
  }

  const header = splitCsvLine(lines[0]);
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
      )} but received ${header.join(",")}`
    );
  }

  for (let index = baseHeader.length; index < header.length; index += 1) {
    if (!optionalHeaderSet.has(header[index])) {
      throw new Error(
        `Unexpected session CSV column "${header[index]}" in ${filePath}`
      );
    }
  }

  const isFirstSessionIndex = header.indexOf("is_first_session");
  const rescheduleInitiatorIndex = header.indexOf("reschedule_initiator");
  const noShowIndex = header.indexOf("no_show");

  const sessions: SessionRecord[] = [];
  let latestDate: string | null = null;

  for (const line of lines.slice(1)) {
    if (!line) {
      continue;
    }
    const row = splitCsvLine(line);
    if (row.length < baseHeader.length || row.length !== header.length) {
      continue;
    }
    const sessionId = row[0];
    const rowTutorId = row[1];
    const dateRaw = row[2];
    const durationRaw = row[3];
    const ratingRaw = row[4];
    const statusRaw = row[5];
    const techIssueRaw = row[6];

    if (!sessionId || !rowTutorId || !dateRaw || !durationRaw || !statusRaw) {
      continue;
    }

    if (!isIsoDate(dateRaw)) {
      continue;
    }

    if (!latestDate || dateRaw > latestDate) {
      latestDate = dateRaw;
    }

    const status = statusRaw as SessionStatus;
    if (!SESSION_STATUSES.includes(status)) {
      continue;
    }

    const hasTechIssue = parseBoolean(techIssueRaw);
    if (hasTechIssue === null) {
      continue;
    }

    if (rowTutorId !== tutorId) {
      continue;
    }

    const durationMinutes = Number.parseInt(durationRaw, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      continue;
    }

    const rating = ratingRaw === "" ? null : Number.parseFloat(ratingRaw);
    if (
      rating !== null &&
      (!Number.isFinite(rating) || rating < 1 || rating > 5)
    ) {
      continue;
    }

    let isFirstSession = false;
    if (isFirstSessionIndex >= 0) {
      const raw = row[isFirstSessionIndex] ?? "";
      if (raw !== "") {
        const parsed = parseBoolean(raw);
        if (parsed === null) {
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
          continue;
        }
      }
    }

    if (status !== "rescheduled") {
      rescheduleInitiator = null;
    }

    let noShow = false;
    if (noShowIndex >= 0) {
      const raw = row[noShowIndex] ?? "";
      if (raw !== "") {
        const parsed = parseBoolean(raw);
        if (parsed === null) {
          continue;
        }
        noShow = parsed;
      }
    }

    sessions.push({
      sessionId,
      tutorId: rowTutorId,
      date: dateRaw,
      durationMinutes,
      rating,
      status,
      hasTechIssue,
      isFirstSession,
      rescheduleInitiator,
      noShow,
    });
  }

  return { sessions, latestDate };
}

function buildDailySeries(
  sessions: SessionRecord[],
  dateRange: string[],
  fallbackScore: number,
  formulaVersion: ScoreFormulaVersion
): DailyPoint[] {
  const sessionsByDate = new Map<string, SessionRecord[]>();
  for (const session of sessions) {
    const list = sessionsByDate.get(session.date);
    if (list) {
      list.push(session);
    } else {
      sessionsByDate.set(session.date, [session]);
    }
  }

  const days: DailyPoint[] = [];
  let lastScore = clampScore(fallbackScore);

  for (const date of dateRange) {
    const dailySessions = sessionsByDate.get(date) ?? [];
    if (dailySessions.length > 0) {
      const metrics = computeMetrics(dailySessions);
      const score = computeScore(metrics, formulaVersion);
      days.push({
        date,
        score,
        kpis: formatMetrics(metrics),
      });
      lastScore = score;
    } else {
      days.push({
        date,
        score: lastScore,
        kpis: emptyDailyKpis(),
      });
    }
  }

  return days;
}

function emptyDailyKpis(): KPIs {
  return {
    avg_rating: null,
    dropout_rate: 0,
    tech_issue_rate: 0,
    reschedule_rate: 0,
    sessions_count: 0,
    first_session_avg_rating: null,
    first_session_dropout_rate: 0,
    first_session_count: 0,
    tutor_initiated_reschedule_rate: 0,
    no_show_rate: 0,
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
  let dropoutCount = 0;
  let rescheduleCount = 0;
  let techIssueCount = 0;
  let tutorInitiatedReschedules = 0;
  let noShowCount = 0;

  let firstSessionRatingSum = 0;
  let firstSessionRatingCount = 0;
  let firstSessionDropoutCount = 0;
  let firstSessionCount = 0;

  for (const session of sessions) {
    if (session.rating !== null) {
      ratingSum += session.rating;
      ratingCount += 1;
    }
    if (session.status === "dropout") {
      dropoutCount += 1;
      if (session.isFirstSession) {
        firstSessionDropoutCount += 1;
      }
    } else if (session.status === "rescheduled") {
      rescheduleCount += 1;
      if (session.rescheduleInitiator === "tutor") {
        tutorInitiatedReschedules += 1;
      }
    }
    if (session.hasTechIssue) {
      techIssueCount += 1;
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
    dropoutRate: total > 0 ? dropoutCount / total : 0,
    techIssueRate: total > 0 ? techIssueCount / total : 0,
    rescheduleRate: total > 0 ? rescheduleCount / total : 0,
    sessionsCount: total,
    firstSessionAvgRating,
    firstSessionDropoutRate:
      firstSessionCount > 0 ? firstSessionDropoutCount / firstSessionCount : 0,
    firstSessionCount,
    tutorInitiatedRescheduleRate:
      rescheduleCount > 0 ? tutorInitiatedReschedules / rescheduleCount : 0,
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
  const ratingForPenalty = metrics.avgRating ?? 5;
  const rawScore =
    100 -
    (metrics.dropoutRate * 40 +
      metrics.techIssueRate * 30 +
      metrics.rescheduleRate * 20 +
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

function formatMetrics(metrics: AggregatedMetrics): KPIs {
  return {
    avg_rating: metrics.avgRating === null ? null : round(metrics.avgRating, 2),
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
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildDateRange(latestDateStr: string, days: number): string[] {
  const latestDate = parseIsoDate(latestDateStr);
  if (!latestDate) {
    throw new Error(`Invalid latest date: ${latestDateStr}`);
  }

  const range: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(latestDate.getTime() - offset * MILLISECONDS_PER_DAY);
    range.push(formatDate(date));
  }
  return range;
}

function parseIsoDate(value: string): Date | null {
  if (!isIsoDate(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function splitCsvLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function extractDateFromTimestamp(value: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return formatDate(date);
}

function getTodayDate(): string {
  return formatDate(new Date());
}
