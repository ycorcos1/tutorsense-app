export type AiTrajectory = "improving" | "declining" | "volatile" | "stable";

export interface AiForecast {
  score7d: number;
  score14d: number;
  trajectory: AiTrajectory;
  confidence: number; // 0-1
  description: string;
}

export interface AiInterventionRecommendation {
  id: string;
  title: string;
  description: string;
  effectiveness: number; // 0-1
  effort: "low" | "medium" | "high";
  rationale: string;
}

export interface AiPersonaProfile {
  id: string;
  label: string;
  description: string;
  strengths: string[];
  risks: string[];
}

export interface AiThresholdRecommendation {
  scoreThreshold: number;
  dropoutRateThreshold: number;
  noShowRateThreshold: number;
  rationale: string;
}

export interface TutorAiInsights {
  modelVersion: string;
  churnProbability: number; // 0-1
  churnConfidence: number; // 0-1
  anomalyScore: number; // 0-1
  forecast: AiForecast;
  interventions: AiInterventionRecommendation[];
  persona: AiPersonaProfile | null;
  summary: string;
  signals: string[];
  thresholdRecommendation: AiThresholdRecommendation;
  coachingPlan: string;
}

export interface AiModelArtifacts {
  weights: Record<string, number>;
  bias: number;
  featureKeys: string[];
  featureMeans: Record<string, number>;
  featureStds: Record<string, number>;
}

export interface TutorFeatureInput {
  tutor_id: string;
  name: string;
  subject: string;
  score: number;
  trend_7d: number[];
  churn_risk: number;
  kpis: {
    avg_rating: number | null;
    dropout_rate: number;
    tech_issue_rate: number;
    reschedule_rate: number;
    sessions_count: number;
    first_session_avg_rating: number | null;
    first_session_dropout_rate: number;
    first_session_count: number;
    tutor_initiated_reschedule_rate: number;
    no_show_rate: number;
  };
}

export interface TutorFeatureVector {
  tutorId: string;
  features: Record<string, number>;
  labelChurn: number;
}

export interface FeatureStatistics {
  means: Record<string, number>;
  stdDevs: Record<string, number>;
}

export interface FeatureMatrix {
  vectors: TutorFeatureVector[];
  featureOrder: string[];
  stats: FeatureStatistics;
}
