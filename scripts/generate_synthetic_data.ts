import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CsvSessionRecord as SessionRecord,
  CsvTutorRecord as TutorRecord,
  SessionStatus,
} from "../types/session";

interface WeightedValue<T> {
  value: T;
  weight: number;
}

const SUBJECT_DISTRIBUTION: Array<WeightedValue<string>> = [
  { value: "Math", weight: 0.22 },
  { value: "Science", weight: 0.18 },
  { value: "English", weight: 0.18 },
  { value: "History", weight: 0.12 },
  { value: "Computer Science", weight: 0.12 },
  { value: "Language Arts", weight: 0.1 },
  { value: "Test Prep", weight: 0.08 },
];

const STATUS_DISTRIBUTION: Array<WeightedValue<SessionStatus>> = [
  { value: "completed", weight: 0.8 },
  { value: "dropout", weight: 0.1 },
  { value: "rescheduled", weight: 0.1 },
];

const AT_RISK_STATUS_DISTRIBUTION: Array<WeightedValue<SessionStatus>> = [
  { value: "completed", weight: 0.4 },
  { value: "dropout", weight: 0.35 },
  { value: "rescheduled", weight: 0.25 },
];

const RATING_DISTRIBUTION: Array<WeightedValue<number>> = [
  { value: 5, weight: 0.4 },
  { value: 4, weight: 0.25 },
  { value: 3, weight: 0.2 },
  { value: 2, weight: 0.1 },
  { value: 1, weight: 0.05 },
];

const AT_RISK_RATING_DISTRIBUTION: Array<WeightedValue<number>> = [
  { value: 5, weight: 0.05 },
  { value: 4, weight: 0.1 },
  { value: 3, weight: 0.2 },
  { value: 2, weight: 0.35 },
  { value: 1, weight: 0.3 },
];

const FIRST_NAMES = [
  "Ava",
  "Noah",
  "Liam",
  "Olivia",
  "Ethan",
  "Mia",
  "Isabella",
  "Mason",
  "Sophia",
  "Logan",
  "Lucas",
  "Emma",
  "Amelia",
  "Harper",
  "Benjamin",
  "Evelyn",
  "Henry",
  "Alexander",
  "Luna",
  "Elijah",
  "Caleb",
  "Scarlett",
  "Victoria",
  "Zoey",
  "Julian",
  "Avery",
  "Chloe",
  "Layla",
  "Penelope",
];

const LAST_NAMES = [
  "Johnson",
  "Williams",
  "Brown",
  "Taylor",
  "Anderson",
  "Thomas",
  "Jackson",
  "White",
  "Harris",
  "Martin",
  "Thompson",
  "Garcia",
  "Martinez",
  "Robinson",
  "Clark",
  "Rodriguez",
  "Lewis",
  "Walker",
  "Hall",
  "Allen",
  "Young",
  "King",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Green",
  "Adams",
  "Nelson",
];

const TUTOR_COUNT = 200;
const TARGET_SESSIONS = 3000;
const DAY_COUNT = 14;
const MIN_DURATION = 25;
const MAX_DURATION = 90;
const NULL_RATING_PROBABILITY = 0.1;
const AT_RISK_TUTOR_COUNT = 15; // Number of tutors to make at-risk (score < 60)
const TUTOR_INITIATED_RESCHEDULE_PROBABILITY = 0.982;
const DROPOUT_NO_SHOW_PROBABILITY = 0.16;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

function createRng(seedInput: string | undefined): () => number {
  const baseSeed =
    seedInput && seedInput.length > 0
      ? hashSeed(seedInput)
      : Math.floor(Date.now() % 4294967295);
  let seed = baseSeed >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(
  rng: () => number,
  options: Array<WeightedValue<T>>
): T {
  const total = options.reduce((acc, option) => acc + option.weight, 0);
  let threshold = rng() * total;
  for (const option of options) {
    if (threshold < option.weight) {
      return option.value;
    }
    threshold -= option.weight;
  }
  return options[options.length - 1].value;
}

function pickArrayItem<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  return items[index];
}

function shuffleInPlace<T>(rng: () => number, items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toCsvRow(values: Array<string | number | boolean>): string {
  return values
    .map((value) => {
      const text = String(value);
      if (text.includes('"')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      if (/[,\n]/.test(text)) {
        return `"${text}"`;
      }
      return text;
    })
    .join(",");
}

function ensureDataDirectory(): string {
  const dataDir = join(__dirname, "..", "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function generateTutors(rng: () => number, baseDate: Date): TutorRecord[] {
  const tutors: TutorRecord[] = [];
  const subjects = SUBJECT_DISTRIBUTION.slice();
  for (let i = 0; i < TUTOR_COUNT; i += 1) {
    const tutorId = `T${(i + 1).toString().padStart(3, "0")}`;
    const name = `${pickArrayItem(rng, FIRST_NAMES)} ${pickArrayItem(
      rng,
      LAST_NAMES
    )}`;
    const subject = pickWeighted(rng, subjects);
    const daysAgo = Math.floor(rng() * 365) + 30;
    const hireDate = new Date(baseDate);
    hireDate.setUTCDate(hireDate.getUTCDate() - daysAgo);
    tutors.push({
      tutor_id: tutorId,
      name,
      subject,
      hire_date: formatDate(hireDate),
    });
  }
  shuffleInPlace(rng, tutors);
  return tutors;
}

function generateSessions(
  rng: () => number,
  tutors: TutorRecord[],
  baseDate: Date
): SessionRecord[] {
  const sessions: SessionRecord[] = [];
  const tutorIds = tutors.map((t) => t.tutor_id);
  const firstSessionSeen = new Set<string>();

  // Identify at-risk tutors (first AT_RISK_TUTOR_COUNT tutors)
  const atRiskTutorIds = new Set(
    tutors.slice(0, AT_RISK_TUTOR_COUNT).map((t) => t.tutor_id)
  );

  let sessionsRemaining = TARGET_SESSIONS;

  const sessionsPerDay: number[] = [];
  for (let dayIndex = 0; dayIndex < DAY_COUNT; dayIndex += 1) {
    const daysLeft = DAY_COUNT - dayIndex;
    const mean = sessionsRemaining / daysLeft;
    const jitter = Math.round((rng() - 0.5) * mean * 0.3);
    let count = Math.round(mean + jitter);
    const minPossible = Math.max(
      0,
      sessionsRemaining - (daysLeft - 1) * Math.round(mean * 1.4)
    );
    if (count < minPossible) {
      count = minPossible;
    }
    if (count > sessionsRemaining - (daysLeft - 1)) {
      count = sessionsRemaining - (daysLeft - 1);
    }
    if (count < 0) {
      count = 0;
    }
    if (dayIndex === DAY_COUNT - 1) {
      count = sessionsRemaining;
    }
    sessionsPerDay.push(count);
    sessionsRemaining -= count;
  }

  const techIssueRate = 0.05 + rng() * 0.1;
  const atRiskTechIssueRate = 0.2 + rng() * 0.15; // 20-35% for at-risk tutors
  let sessionCounter = 0;
  for (let offset = 0; offset < DAY_COUNT; offset += 1) {
    const sessionsForDay = sessionsPerDay[offset];
    const sessionDate = new Date(baseDate);
    sessionDate.setUTCDate(sessionDate.getUTCDate() - offset);
    const formattedDate = formatDate(sessionDate);

    for (let i = 0; i < sessionsForDay; i += 1) {
      sessionCounter += 1;
      const tutorId = pickArrayItem(rng, tutorIds);
      const isAtRisk = atRiskTutorIds.has(tutorId);

      const status = pickWeighted(
        rng,
        isAtRisk ? AT_RISK_STATUS_DISTRIBUTION : STATUS_DISTRIBUTION
      );
      const rating =
        rng() < NULL_RATING_PROBABILITY
          ? null
          : pickWeighted(
              rng,
              isAtRisk ? AT_RISK_RATING_DISTRIBUTION : RATING_DISTRIBUTION
            );
      const duration =
        MIN_DURATION + Math.floor(rng() * (MAX_DURATION - MIN_DURATION + 1));
      const sessionId = `S${sessionCounter.toString().padStart(5, "0")}`;
      const hasTechIssue =
        rng() < (isAtRisk ? atRiskTechIssueRate : techIssueRate);

      const isFirstSession = !firstSessionSeen.has(tutorId);
      if (isFirstSession) {
        firstSessionSeen.add(tutorId);
      }

      const rescheduleInitiator =
        status === "rescheduled"
          ? rng() < TUTOR_INITIATED_RESCHEDULE_PROBABILITY
            ? "tutor"
            : "student"
          : undefined;

      const noShow =
        status === "dropout" ? rng() < DROPOUT_NO_SHOW_PROBABILITY : false;

      sessions.push({
        session_id: sessionId,
        tutor_id: tutorId,
        date: formattedDate,
        duration_minutes: duration,
        rating,
        status,
        has_tech_issue: hasTechIssue,
        is_first_session: isFirstSession,
        reschedule_initiator: rescheduleInitiator,
        no_show: noShow,
      });
    }
  }

  return sessions;
}

function stringifyTutors(tutors: TutorRecord[]): string {
  const header = "tutor_id,name,subject,hire_date";
  const rows = tutors.map((tutor) =>
    toCsvRow([tutor.tutor_id, tutor.name, tutor.subject, tutor.hire_date])
  );
  return [header, ...rows].join("\n") + "\n";
}

function stringifySessions(sessions: SessionRecord[]): string {
  const header =
    "session_id,tutor_id,date,duration_minutes,rating,status,has_tech_issue,is_first_session,reschedule_initiator,no_show";
  const rows = sessions.map((session) =>
    toCsvRow([
      session.session_id,
      session.tutor_id,
      session.date,
      session.duration_minutes,
      session.rating === null ? "" : session.rating,
      session.status,
      session.has_tech_issue,
      session.is_first_session ?? false,
      session.reschedule_initiator ?? "",
      session.no_show ?? false,
    ])
  );
  return [header, ...rows].join("\n") + "\n";
}

function summarize(
  tutors: TutorRecord[],
  sessions: SessionRecord[]
): Record<string, string | number> {
  const statusCounts: Record<SessionStatus, number> = {
    completed: 0,
    dropout: 0,
    rescheduled: 0,
  };
  let techIssues = 0;
  let ratedSessions = 0;
  let ratingTotal = 0;
  let earliestDate: string | null = null;
  let latestDate: string | null = null;

  for (const session of sessions) {
    statusCounts[session.status] += 1;
    if (session.has_tech_issue) {
      techIssues += 1;
    }
    if (session.rating !== null) {
      ratedSessions += 1;
      ratingTotal += session.rating;
    }
    if (!earliestDate || session.date < earliestDate) {
      earliestDate = session.date;
    }
    if (!latestDate || session.date > latestDate) {
      latestDate = session.date;
    }
  }

  const avgRating = ratedSessions > 0 ? ratingTotal / ratedSessions : 0;

  return {
    tutors: tutors.length,
    sessions: sessions.length,
    completed: statusCounts.completed,
    dropout: statusCounts.dropout,
    rescheduled: statusCounts.rescheduled,
    tech_issue_rate:
      sessions.length > 0 ? (techIssues / sessions.length).toFixed(3) : "0.000",
    rated_sessions: ratedSessions,
    average_rating: avgRating.toFixed(2),
    date_range:
      earliestDate && latestDate ? `${earliestDate} → ${latestDate}` : "n/a",
  };
}

function logSummary(summary: Record<string, string | number>): void {
  console.log("Synthetic data generation summary:");
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key}: ${value}`);
  }
}

export async function run(): Promise<void> {
  const dataDir = ensureDataDirectory();
  const rng = createRng(process.env.SEED);
  const now = new Date();
  const baseDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  const tutors = generateTutors(rng, baseDate);
  const sessions = generateSessions(rng, tutors, baseDate);

  const tutorsCsv = stringifyTutors(tutors);
  const sessionsCsv = stringifySessions(sessions);

  writeFileSync(join(dataDir, "tutors.csv"), tutorsCsv, "utf8");
  writeFileSync(join(dataDir, "sessions.csv"), sessionsCsv, "utf8");

  const summary = summarize(tutors, sessions);
  logSummary(summary);
  console.log(
    `Data written to ${join(dataDir, "tutors.csv")} and ${join(
      dataDir,
      "sessions.csv"
    )}`
  );
}

declare const require: NodeRequire | undefined;
declare const module: NodeModule | undefined;

const executedPath =
  typeof process !== "undefined" && process.argv.length > 1
    ? process.argv[1]
    : undefined;
const currentPath = __filename;
const isCjsEntry =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;
const isEsmEntry = executedPath === currentPath;

if (isCjsEntry || isEsmEntry) {
  run().catch((error) => {
    console.error("Failed to generate synthetic data:", error);
    process.exitCode = 1;
  });
}
