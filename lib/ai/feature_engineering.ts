import type { FeatureMatrix, FeatureStatistics, TutorFeatureInput, TutorFeatureVector } from "../../types/ai";

const FEATURE_KEYS = [
  "dropout_rate",
  "tech_issue_rate",
  "reschedule_rate",
  "sessions_count",
  "avg_rating",
  "first_session_avg_rating",
  "first_session_dropout_rate",
  "first_session_count",
  "tutor_initiated_reschedule_rate",
  "no_show_rate",
  "score",
  "trend_slope",
  "trend_variance",
  "trend_velocity",
  "churn_risk",
];

function safeNumber(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

function computeTrendSlope(trend: number[]): number {
  if (trend.length === 0) {
    return 0;
  }
  const n = trend.length;
  const xMean = (n - 1) / 2;
  const yMean = trend.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i;
    const y = trend[i];
    numerator += (x - xMean) * (y - yMean);
    denominator += (x - xMean) ** 2;
  }
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function computeTrendVariance(trend: number[]): number {
  if (trend.length === 0) {
    return 0;
  }
  const mean = trend.reduce((sum, value) => sum + value, 0) / trend.length;
  const variance =
    trend.reduce((sum, value) => sum + (value - mean) ** 2, 0) / trend.length;
  return variance;
}

function computeTrendVelocity(trend: number[]): number {
  if (trend.length < 2) {
    return 0;
  }
  const recent = trend[trend.length - 1];
  const previous = trend[0];
  return recent - previous;
}

function buildFeatureVector(tutor: TutorFeatureInput): TutorFeatureVector {
  const {
    kpis,
    score,
    trend_7d,
    churn_risk,
  } = tutor;

  const trendSlope = computeTrendSlope(trend_7d);
  const trendVariance = computeTrendVariance(trend_7d);
  const trendVelocity = computeTrendVelocity(trend_7d);

  const features: Record<string, number> = {
    dropout_rate: safeNumber(kpis.dropout_rate),
    tech_issue_rate: safeNumber(kpis.tech_issue_rate),
    reschedule_rate: safeNumber(kpis.reschedule_rate),
    sessions_count: safeNumber(kpis.sessions_count),
    avg_rating: safeNumber(kpis.avg_rating),
    first_session_avg_rating: safeNumber(kpis.first_session_avg_rating),
    first_session_dropout_rate: safeNumber(kpis.first_session_dropout_rate),
    first_session_count: safeNumber(kpis.first_session_count),
    tutor_initiated_reschedule_rate: safeNumber(
      kpis.tutor_initiated_reschedule_rate
    ),
    no_show_rate: safeNumber(kpis.no_show_rate),
    score: safeNumber(score),
    trend_slope: trendSlope,
    trend_variance: trendVariance,
    trend_velocity: trendVelocity,
    churn_risk: safeNumber(churn_risk / 100),
  };

  const labelChurn =
    score < 60 || churn_risk > 55 || kpis.dropout_rate > 0.18 ? 1 : 0;

  return {
    tutorId: tutor.tutor_id,
    features,
    labelChurn,
  };
}

function computeStatistics(vectors: TutorFeatureVector[]): FeatureStatistics {
  const means: Record<string, number> = {};
  const stdDevs: Record<string, number> = {};

  for (const key of FEATURE_KEYS) {
    const values = vectors.map((vector) => vector.features[key] ?? 0);
    const mean =
      values.reduce((sum, value) => sum + value, 0) /
      Math.max(values.length, 1);
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(values.length, 1);
    const stdDev = Math.sqrt(variance) || 1;
    means[key] = mean;
    stdDevs[key] = stdDev;
  }

  return { means, stdDevs };
}

export function normaliseFeature(
  value: number,
  mean: number,
  stdDev: number
): number {
  if (stdDev === 0) {
    return 0;
  }
  return (value - mean) / stdDev;
}

export function buildFeatureMatrix(
  tutors: TutorFeatureInput[]
): FeatureMatrix {
  const vectors = tutors.map(buildFeatureVector);
  const stats = computeStatistics(vectors);
  return {
    vectors,
    stats,
    featureOrder: [...FEATURE_KEYS],
  };
}

export function toArrayFeatures(
  vector: TutorFeatureVector,
  stats: FeatureStatistics,
  featureOrder: string[]
): number[] {
  return featureOrder.map((key) =>
    normaliseFeature(vector.features[key] ?? 0, stats.means[key], stats.stdDevs[key])
  );
}
