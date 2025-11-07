import type {
  AiModelArtifacts,
  FeatureMatrix,
  TutorFeatureVector,
} from "../../types/ai";
import { normaliseFeature } from "./feature_engineering.ts";

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

interface TrainOptions {
  learningRate?: number;
  iterations?: number;
  regularization?: number;
}

const DEFAULT_OPTIONS: Required<TrainOptions> = {
  learningRate: 0.3,
  iterations: 600,
  regularization: 0.0005,
};

function initialiseWeights(featureKeys: string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const key of featureKeys) {
    weights[key] = 0;
  }
  return weights;
}

function computePrediction(
  vector: TutorFeatureVector,
  weights: Record<string, number>,
  bias: number,
  stats: FeatureMatrix["stats"],
  featureOrder: string[]
): number {
  let sum = bias;
  for (const key of featureOrder) {
    const value = vector.features[key] ?? 0;
    const normalised = normaliseFeature(
      value,
      stats.means[key],
      stats.stdDevs[key]
    );
    sum += weights[key] * normalised;
  }
  return sigmoid(sum);
}

export function trainChurnModel(
  matrix: FeatureMatrix,
  options: TrainOptions = {}
): AiModelArtifacts {
  const { featureOrder, vectors, stats } = matrix;
  if (vectors.length === 0) {
    return {
      weights: initialiseWeights(featureOrder),
      bias: 0,
      featureKeys: featureOrder,
      featureMeans: stats.means,
      featureStds: stats.stdDevs,
    };
  }
  const hyperParams: Required<TrainOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let bias = 0;
  const weights = initialiseWeights(featureOrder);

  for (let iteration = 0; iteration < hyperParams.iterations; iteration += 1) {
    let biasGradient = 0;
    const weightGradients: Record<string, number> = {};
    for (const key of featureOrder) {
      weightGradients[key] = 0;
    }

    for (const vector of vectors) {
      const prediction = computePrediction(
        vector,
        weights,
        bias,
        stats,
        featureOrder
      );
      const error = prediction - vector.labelChurn;
      biasGradient += error;
      for (const key of featureOrder) {
        const value = vector.features[key] ?? 0;
        const normalised = normaliseFeature(
          value,
          stats.means[key],
          stats.stdDevs[key]
        );
        weightGradients[key] += error * normalised;
      }
    }

    bias -= (hyperParams.learningRate / vectors.length) * biasGradient;
    for (const key of featureOrder) {
      const regularisationTerm = hyperParams.regularization * weights[key];
      weights[key] -=
        (hyperParams.learningRate / vectors.length) * weightGradients[key] +
        regularisationTerm;
    }
  }

  return {
    weights,
    bias,
    featureKeys: featureOrder,
    featureMeans: stats.means,
    featureStds: stats.stdDevs,
  };
}

export interface ChurnPrediction {
  probability: number; // 0-1
  confidence: number; // 0-1
}

export function predictChurn(
  vector: TutorFeatureVector,
  model: AiModelArtifacts
): ChurnPrediction {
  const { weights, bias, featureKeys, featureMeans, featureStds } = model;

  let sum = bias;
  for (const key of featureKeys) {
    const value = vector.features[key] ?? 0;
    const normalised = normaliseFeature(
      value,
      featureMeans[key],
      featureStds[key]
    );
    sum += weights[key] * normalised;
  }

  const probability = sigmoid(sum);
  const confidence = Math.min(1, Math.abs(sum) / 4 + 0.25);

  return { probability, confidence };
}
