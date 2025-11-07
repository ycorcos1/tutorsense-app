export interface AggregatedMetrics {
  avgRating: number | null;
  dropoutRate: number;
  techIssueRate: number;
  rescheduleRate: number;
  sessionsCount: number;
  firstSessionAvgRating: number | null;
  firstSessionDropoutRate: number;
  firstSessionCount: number;
  tutorInitiatedRescheduleRate: number;
  tutorInitiatedRescheduleCount: number;
  noShowRate: number;
  noShowCount: number;
}

export interface TutorKpis {
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
}
