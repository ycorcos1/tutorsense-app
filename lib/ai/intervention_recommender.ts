import type {
  AiInterventionRecommendation,
  TutorFeatureVector,
} from "../../types/ai";

interface InterventionContext {
  churnProbability: number;
  anomalyScore: number;
  forecastTrajectory: "improving" | "declining" | "volatile" | "stable";
}

const INTERVENTION_LIBRARY: Array<{
  id: string;
  match: (vector: TutorFeatureVector, context: InterventionContext) => number;
  build: (vector: TutorFeatureVector) => AiInterventionRecommendation;
}> = [
  {
    id: "first-session-rescue",
    match: (vector) => {
      const dropout = vector.features.first_session_dropout_rate ?? 0;
      const rating = vector.features.first_session_avg_rating ?? 5;
      return Math.max(0, dropout * 2 + (3.5 - rating));
    },
    build: (vector) => {
      const dropout = Math.round(
        (vector.features.first_session_dropout_rate ?? 0) * 100
      );
      return {
        id: "first-session-rescue",
        title: "First Session Rescue Plan",
        description:
          "Deploy shadow onboarding, expectation-setting scripts, and immediate post-session follow-ups to stabilize first impressions.",
        effectiveness: 0.75,
        effort: "medium",
        rationale: `First-session dropout rate is ${dropout}% requiring targeted onboarding support.`,
      };
    },
  },
  {
    id: "tech-intervention",
    match: (vector) => (vector.features.tech_issue_rate ?? 0) * 4,
    build: (vector) => {
      const techIssues = Math.round((vector.features.tech_issue_rate ?? 0) * 100);
      return {
        id: "tech-intervention",
        title: "Technical Coaching & Equipment Audit",
        description:
          "Schedule a diagnostics session, run through the platform checklist, and provide backup equipment recommendations.",
        effectiveness: 0.68,
        effort: "high",
        rationale: `Tech issue rate at ${techIssues}% indicates recurring technical blockers.`,
      };
    },
  },
  {
    id: "scheduling-discipline",
    match: (vector) => (vector.features.tutor_initiated_reschedule_rate ?? 0) * 3,
    build: (vector) => {
      const rate = Math.round(
        (vector.features.tutor_initiated_reschedule_rate ?? 0) * 100
      );
      return {
        id: "scheduling-discipline",
        title: "Scheduling Discipline Reset",
        description:
          "Introduce confirmation cadences, calendar guardrails, and accountability rituals to reduce tutor-initiated reschedules.",
        effectiveness: 0.62,
        effort: "medium",
        rationale: `Tutor-initiated reschedules at ${rate}% are destabilizing student expectations.`,
      };
    },
  },
  {
    id: "no-show-mitigation",
    match: (vector) => (vector.features.no_show_rate ?? 0) * 4,
    build: (vector) => {
      const rate = Math.round((vector.features.no_show_rate ?? 0) * 100);
      return {
        id: "no-show-mitigation",
        title: "Attendance Reinforcement",
        description:
          "Activate reminder automations, implement last-mile check-ins, and escalate repeat no-shows to coaching leadership.",
        effectiveness: 0.65,
        effort: "medium",
        rationale: `No-show rate at ${rate}% demands attendance safeguards.`,
      };
    },
  },
  {
    id: "quality-lift",
    match: (vector) => {
      const rating = vector.features.avg_rating ?? 5;
      return Math.max(0, 4.5 - rating);
    },
    build: (vector) => {
      const rating = (vector.features.avg_rating ?? 0).toFixed(1);
      return {
        id: "quality-lift",
        title: "Quality Lift Mentorship",
        description:
          "Pair with top-performing mentor for feedback loops, session reviews, and targeted skill drills.",
        effectiveness: 0.58,
        effort: "high",
        rationale: `Average rating at ${rating} indicates opportunity for structured quality coaching.`,
      };
    },
  },
  {
    id: "momentum-boost",
    match: (vector, context) =>
      context.forecastTrajectory === "declining"
        ? Math.abs(vector.features.trend_velocity ?? 0) / 10
        : 0,
    build: () => ({
      id: "momentum-boost",
      title: "Momentum Boost Sprint",
      description:
        "Launch a 7-day performance sprint with defined targets, daily check-ins, and progress dashboards to reverse decline.",
      effectiveness: 0.55,
      effort: "low",
      rationale: "Forecast indicates decline; proactive sprint can reverse momentum.",
    }),
  },
];

export function recommendInterventions(
  vector: TutorFeatureVector,
  context: InterventionContext
): AiInterventionRecommendation[] {
  const scored = INTERVENTION_LIBRARY.map((item) => ({
    intervention: item.build(vector),
    score: item.match(vector, context),
  })).filter((entry) => entry.score > 0.05);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((entry, index) => ({
    ...entry.intervention,
    effectiveness: Math.min(0.95, entry.intervention.effectiveness + index * 0.05),
  }));
}
