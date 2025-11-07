import type { AiForecast } from "../../types/ai";

interface ForecastInput {
  trend: number[];
  currentScore: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function computeLinearRegression(trend: number[]): { slope: number; intercept: number } {
  const n = trend.length;
  if (n === 0) {
    return { slope: 0, intercept: 0 };
  }
  const xMean = (n - 1) / 2;
  const yMean = trend.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * (trend[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function projectValue(
  index: number,
  slope: number,
  intercept: number,
  fallback: number
): number {
  const value = slope * index + intercept;
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function classifyTrajectory(slope: number, variance: number): "improving" | "declining" | "volatile" | "stable" {
  if (Math.abs(slope) < 0.5 && variance > 30) {
    return "volatile";
  }
  if (slope > 0.5) {
    return "improving";
  }
  if (slope < -0.5) {
    return "declining";
  }
  return "stable";
}

function computeVariance(trend: number[]): number {
  if (trend.length === 0) {
    return 0;
  }
  const mean = trend.reduce((sum, value) => sum + value, 0) / trend.length;
  return trend.reduce((sum, value) => sum + (value - mean) ** 2, 0) / trend.length;
}

function describeTrajectory(
  trajectory: AiForecast["trajectory"],
  score7d: number,
  score14d: number
): string {
  switch (trajectory) {
    case "improving":
      return `Projected to improve to ${score7d.toFixed(0)} in 7 days and ${score14d.toFixed(0)} within 14 days.`;
    case "declining":
      return `Projected decline to ${score7d.toFixed(0)} in 7 days and ${score14d.toFixed(0)} within 14 days.`;
    case "volatile":
      return `Performance is volatile. Expected range ${Math.min(score7d, score14d).toFixed(0)}–${Math.max(score7d, score14d).toFixed(0)} over the next 2 weeks.`;
    default:
      return `Performance expected to remain stable around ${((score7d + score14d) / 2).toFixed(0)}.`;
  }
}

export function forecastTrend({ trend, currentScore }: ForecastInput): AiForecast {
  const regression = computeLinearRegression(trend);
  const variance = computeVariance(trend);
  const nextIndex7 = trend.length + 7;
  const nextIndex14 = trend.length + 14;
  const projected7 = projectValue(nextIndex7, regression.slope, regression.intercept, currentScore);
  const projected14 = projectValue(nextIndex14, regression.slope, regression.intercept, projected7);
  const clamped7 = clamp(projected7, 0, 100);
  const clamped14 = clamp(projected14, 0, 100);
  const trajectory = classifyTrajectory(regression.slope, variance);
  const confidence = clamp(1 - Math.min(1, variance / 80), 0.2, 0.95);

  return {
    score7d: clamped7,
    score14d: clamped14,
    trajectory,
    confidence,
    description: describeTrajectory(trajectory, clamped7, clamped14),
  };
}
