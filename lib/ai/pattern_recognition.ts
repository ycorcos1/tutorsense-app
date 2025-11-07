import type { TutorFeatureVector, AiPersonaProfile } from "../../types/ai";

interface ClusterResult {
  persona: AiPersonaProfile;
}

const PERSONA_LIBRARY: AiPersonaProfile[] = [
  {
    id: "rising-star",
    label: "Rising Star",
    description:
      "Strong fundamentals with positive momentum. Benefit from advanced coaching to accelerate growth.",
    strengths: ["Consistent improvements", "High student satisfaction"],
    risks: ["Needs stretch assignments", "Watch for burnout"],
  },
  {
    id: "at-risk-newcomer",
    label: "At-Risk Newcomer",
    description:
      "Early-stage tutor with unstable first-session outcomes. Requires structured onboarding support.",
    strengths: ["Coachability", "Fresh perspective"],
    risks: ["High first-session churn", "Inconsistent delivery"],
  },
  {
    id: "reliability-challenged",
    label: "Reliability Challenged",
    description:
      "High dropout or reschedule behavior impacting student trust. Focus on accountability frameworks.",
    strengths: ["Strong subject expertise"],
    risks: ["Scheduling reliability", "Attendance issues"],
  },
  {
    id: "stabilizing",
    label: "Stabilizing Performer",
    description:
      "Recovering from previous performance issues with signs of stabilization. Keep momentum with lightweight support.",
    strengths: ["Trend improving", "Responds to coaching"],
    risks: ["Fragile confidence", "Needs reinforcement"],
  },
];

function euclideanDistance(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const key of keys) {
    const diff = (a[key] ?? 0) - (b[key] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function computeCentroid(vectors: Record<string, number>[]): Record<string, number> {
  const centroid: Record<string, number> = {};
  const keys = new Set<string>();
  for (const vector of vectors) {
    Object.keys(vector).forEach((key) => keys.add(key));
  }
  for (const key of keys) {
    const mean =
      vectors.reduce((sum, vector) => sum + (vector[key] ?? 0), 0) /
      Math.max(vectors.length, 1);
    centroid[key] = mean;
  }
  return centroid;
}

function normaliseVector(vector: TutorFeatureVector): Record<string, number> {
  return {
    dropout_rate: vector.features.dropout_rate ?? 0,
    first_session_dropout_rate: vector.features.first_session_dropout_rate ?? 0,
    tutor_initiated_reschedule_rate:
      vector.features.tutor_initiated_reschedule_rate ?? 0,
    no_show_rate: vector.features.no_show_rate ?? 0,
    trend_velocity: (vector.features.trend_velocity ?? 0) / 100,
    trend_slope: (vector.features.trend_slope ?? 0) / 100,
    score: (vector.features.score ?? 0) / 100,
  };
}

export function assignPersona(vector: TutorFeatureVector): AiPersonaProfile {
  const featureVector = normaliseVector(vector);

  let closest: AiPersonaProfile = PERSONA_LIBRARY[0];
  let minDistance = Infinity;

  for (const persona of PERSONA_LIBRARY) {
    const centroid = personaToCentroid(persona);
    const distance = euclideanDistance(featureVector, centroid);
    if (distance < minDistance) {
      minDistance = distance;
      closest = persona;
    }
  }

  return closest;
}

function personaToCentroid(persona: AiPersonaProfile): Record<string, number> {
  switch (persona.id) {
    case "rising-star":
      return {
        dropout_rate: 0.05,
        first_session_dropout_rate: 0.05,
        tutor_initiated_reschedule_rate: 0.05,
        no_show_rate: 0.03,
        trend_velocity: 0.2,
        trend_slope: 0.3,
        score: 0.85,
      };
    case "at-risk-newcomer":
      return {
        dropout_rate: 0.2,
        first_session_dropout_rate: 0.35,
        tutor_initiated_reschedule_rate: 0.1,
        no_show_rate: 0.05,
        trend_velocity: -0.15,
        trend_slope: -0.1,
        score: 0.45,
      };
    case "reliability-challenged":
      return {
        dropout_rate: 0.25,
        first_session_dropout_rate: 0.2,
        tutor_initiated_reschedule_rate: 0.35,
        no_show_rate: 0.2,
        trend_velocity: -0.05,
        trend_slope: -0.05,
        score: 0.5,
      };
    case "stabilizing":
      return {
        dropout_rate: 0.12,
        first_session_dropout_rate: 0.12,
        tutor_initiated_reschedule_rate: 0.15,
        no_show_rate: 0.08,
        trend_velocity: 0.05,
        trend_slope: 0.1,
        score: 0.65,
      };
    default:
      return {
        dropout_rate: 0.15,
        first_session_dropout_rate: 0.15,
        tutor_initiated_reschedule_rate: 0.15,
        no_show_rate: 0.1,
        trend_velocity: 0,
        trend_slope: 0,
        score: 0.6,
      };
  }
}

export function buildClusterInsights(
  vector: TutorFeatureVector
): ClusterResult {
  const persona = assignPersona(vector);
  return { persona };
}
