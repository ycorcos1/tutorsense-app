export type SessionStatus = "completed" | "dropout" | "rescheduled";

export type RescheduleInitiator = "tutor" | "student";

export interface CsvSessionRecord {
  session_id: string;
  tutor_id: string;
  date: string;
  duration_minutes: number;
  rating: number | null;
  status: SessionStatus;
  has_tech_issue: boolean;
  is_first_session?: boolean;
  reschedule_initiator?: RescheduleInitiator;
  no_show?: boolean;
}

export interface CsvTutorRecord {
  tutor_id: string;
  name: string;
  subject: string;
  hire_date: string;
}

export interface SessionRecord {
  sessionId: string;
  tutorId: string;
  date: string; // YYYY-MM-DD
  durationMinutes: number;
  rating: number | null;
  status: SessionStatus;
  hasTechIssue: boolean;
  isFirstSession: boolean;
  rescheduleInitiator: RescheduleInitiator | null;
  noShow: boolean;
}

export interface TutorRecord {
  tutorId: string;
  name: string;
  subject: string;
  hireDate: string;
}
