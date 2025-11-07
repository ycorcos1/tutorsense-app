import type { TutorAiInsights, TutorFeatureInput } from "../../types/ai";
import { buildFeatureMatrix } from "./feature_engineering.ts";
import { trainChurnModel, predictChurn } from "./churn_predictor.ts";
import { detectAnomaly } from "./anomaly_detector.ts";
import { forecastTrend } from "./trend_forecaster.ts";
import { recommendInterventions } from "./intervention_recommender.ts";
import { buildClusterInsights } from "./pattern_recognition.ts";
import { computeDynamicThresholds } from "./threshold_optimizer.ts";
import { buildCoachingPlan } from "./ai_content_generator.ts";

interface AiOrchestratorResult {
  insights: Map<string, TutorAiInsights>;
  thresholdSummary: {
    scoreThreshold: number;
    dropoutRateThreshold: number;
    noShowRateThreshold: number;
    rationale: string;
  };
}

function buildSignals(insights: TutorAiInsights): string[] {
  const signals: string[] = [];
  if (insights.churnProbability > 0.7) {
    signals.push(
      `High churn probability (${(insights.churnProbability * 100).toFixed(
        0
      )}%)`
    );
  } else if (insights.churnProbability > 0.45) {
    signals.push(
      `Moderate churn probability (${(insights.churnProbability * 100).toFixed(
        0
      )}%)`
    );
  }

  if (insights.anomalyScore > 0.65) {
    signals.push("Critical anomaly detected");
  } else if (insights.anomalyScore > 0.4) {
    signals.push("Unusual metric pattern detected");
  }

  if (insights.forecast.trajectory === "declining") {
    signals.push("Forecast indicates decline");
  } else if (insights.forecast.trajectory === "volatile") {
    signals.push("Performance is volatile");
  }

  if (insights.persona) {
    signals.push(`Persona: ${insights.persona.label}`);
  }

  return signals;
}

export function generateAiInsights(
  tutors: TutorFeatureInput[]
): AiOrchestratorResult {
  const matrix = buildFeatureMatrix(tutors);
  const model = trainChurnModel(matrix);
  const thresholds = computeDynamicThresholds(matrix.vectors);

  const insightsMap = new Map<string, TutorAiInsights>();

  for (const vector of matrix.vectors) {
    const churn = predictChurn(vector, model);
    const anomaly = detectAnomaly(vector, matrix);
    const matchedTutor = tutors.find(
      (tutor) => tutor.tutor_id === vector.tutorId
    );
    if (!matchedTutor) {
      continue;
    }
    const forecast = forecastTrend({
      trend: matchedTutor.trend_7d,
      currentScore: matchedTutor.score,
    });
    const personaResult = buildClusterInsights(vector);
    const interventions = recommendInterventions(vector, {
      churnProbability: churn.probability,
      anomalyScore: anomaly.score,
      forecastTrajectory: forecast.trajectory,
    });
    const summaryParts: string[] = [];
    summaryParts.push(
      `Churn probability ${(churn.probability * 100).toFixed(0)}% (${(
        churn.confidence * 100
      ).toFixed(0)}% confidence).`
    );
    summaryParts.push(
      `Forecast: ${
        forecast.trajectory
      } (${forecast.description.toLowerCase()}).`
    );
    if (anomaly.label !== "normal") {
      summaryParts.push(`Anomaly level: ${anomaly.label}.`);
    }
    if (personaResult.persona) {
      summaryParts.push(`Persona: ${personaResult.persona.label}.`);
    }

    const signals = buildSignals({
      modelVersion: "ai.v1",
      churnProbability: churn.probability,
      churnConfidence: churn.confidence,
      anomalyScore: anomaly.score,
      forecast,
      interventions,
      persona: personaResult.persona,
      summary: "",
      signals: [],
      thresholdRecommendation: {
        scoreThreshold: thresholds.scoreThreshold,
        dropoutRateThreshold: thresholds.dropoutRateThreshold,
        noShowRateThreshold: thresholds.noShowRateThreshold,
        rationale: thresholds.rationale,
      },
      coachingPlan: "",
    });

    const summary = summaryParts.join(" ");

    const baseInsight: TutorAiInsights = {
      modelVersion: "ai.v1",
      churnProbability: churn.probability,
      churnConfidence: churn.confidence,
      anomalyScore: anomaly.score,
      forecast,
      interventions,
      persona: personaResult.persona,
      summary,
      signals,
      thresholdRecommendation: {
        scoreThreshold: thresholds.scoreThreshold,
        dropoutRateThreshold: thresholds.dropoutRateThreshold,
        noShowRateThreshold: thresholds.noShowRateThreshold,
        rationale: thresholds.rationale,
      },
      coachingPlan: "",
    };

    // Enrich signals now that summary exists
    baseInsight.signals = buildSignals(baseInsight);
    baseInsight.coachingPlan = buildCoachingPlan(
      baseInsight,
      matchedTutor.name
    );

    insightsMap.set(vector.tutorId, baseInsight);
  }

  return {
    insights: insightsMap,
    thresholdSummary: {
      scoreThreshold: thresholds.scoreThreshold,
      dropoutRateThreshold: thresholds.dropoutRateThreshold,
      noShowRateThreshold: thresholds.noShowRateThreshold,
      rationale: thresholds.rationale,
    },
  };
}
