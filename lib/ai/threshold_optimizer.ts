import type { TutorFeatureVector } from "../../types/ai";

export interface ThresholdConfig {
  scoreThreshold: number;
  dropoutRateThreshold: number;
  noShowRateThreshold: number;
  rationale: string;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((percentileValue / 100) * (sorted.length - 1));
  return sorted[index];
}

export function computeDynamicThresholds(
  vectors: TutorFeatureVector[]
): ThresholdConfig {
  const scores = vectors.map((vector) => vector.features.score ?? 0);
  const dropoutRates = vectors.map(
    (vector) => vector.features.dropout_rate ?? 0
  );
  const noShowRates = vectors.map((vector) => vector.features.no_show_rate ?? 0);

  const scoreThreshold = Math.round(percentile(scores, 35));
  const dropoutThreshold = Number((percentile(dropoutRates, 70) * 100).toFixed(1));
  const noShowThreshold = Number((percentile(noShowRates, 70) * 100).toFixed(1));

  return {
    scoreThreshold,
    dropoutRateThreshold: dropoutThreshold,
    noShowRateThreshold: noShowThreshold,
    rationale: `Thresholds calibrated from current distribution (score P35=${scoreThreshold}, dropout P70=${dropoutThreshold}%, no-show P70=${noShowThreshold}%).`,
  };
}
