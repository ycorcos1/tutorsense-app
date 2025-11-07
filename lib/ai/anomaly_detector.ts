import type { FeatureMatrix, TutorFeatureVector } from "../../types/ai";

function computeZScore(
  value: number,
  mean: number,
  stdDev: number
): number {
  if (stdDev === 0) {
    return 0;
  }
  return (value - mean) / stdDev;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export interface AnomalyResult {
  score: number; // 0-1
  label: "normal" | "watch" | "critical";
  contributors: string[];
}

const WEIGHTED_FEATURES: Record<string, number> = {
  dropout_rate: 1.2,
  no_show_rate: 1.1,
  tutor_initiated_reschedule_rate: 1.0,
  trend_velocity: 0.8,
  trend_variance: 0.6,
  sessions_count: 0.4,
};

export function detectAnomaly(
  vector: TutorFeatureVector,
  matrix: FeatureMatrix
): AnomalyResult {
  const contributors: string[] = [];
  let anomalyScore = 0;

  for (const [feature, weight] of Object.entries(WEIGHTED_FEATURES)) {
    const mean = matrix.stats.means[feature] ?? 0;
    const stdDev = matrix.stats.stdDevs[feature] ?? 1;
    const value = vector.features[feature] ?? 0;
    const zScore = Math.abs(computeZScore(value, mean, stdDev));
    anomalyScore += zScore * weight;
    if (zScore > 1.75) {
      contributors.push(`${feature.replaceAll("_", " ")}: z=${zScore.toFixed(2)}`);
    }
  }

  const normalised = clamp(anomalyScore / 12, 0, 1);
  const label = normalised > 0.65 ? "critical" : normalised > 0.4 ? "watch" : "normal";

  return {
    score: normalised,
    label,
    contributors,
  };
}
