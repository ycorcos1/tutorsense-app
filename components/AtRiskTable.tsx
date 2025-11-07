"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Sparkline from "./Sparkline";

type KPIs = {
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

type Explanation = {
  why: string;
  suggested_action: string;
};

export type Tutor = {
  tutor_id: string;
  name: string;
  subject: string;
  score: number;
  trend_7d: number[];
  kpis: KPIs;
  churn_risk: number;
  explanation?: Explanation;
};

type ScoresResponse = {
  generated_at: string;
  formula_version?: string;
  tutors: Tutor[];
};

export type AtRiskTableMeta = {
  generatedAt: string;
  explanationsCount: number;
  formulaVersion: string | null;
};

type AtRiskTableProps = {
  onSelectTutor?: (tutor: Tutor) => void;
  className?: string;
  subjectFilter?: string;
  scoreThreshold?: number;
  onLoaded?: (meta: AtRiskTableMeta) => void;
  resetKey?: number;
};

function getScoreClass(score: number): string {
  const baseClasses =
    "inline-flex min-w-[3rem] items-center justify-center rounded-full px-2 py-1 text-sm font-semibold border";

  if (score < 60) {
    return `${baseClasses} border-red-200 bg-red-50 text-red-700`;
  }

  if (score < 80) {
    return `${baseClasses} border-amber-200 bg-amber-50 text-amber-700`;
  }

  return `${baseClasses} border-green-200 bg-green-50 text-green-700`;
}

function formatWhy(explanation?: Explanation): string {
  if (!explanation || !explanation.why?.trim()) {
    return "—";
  }
  return explanation.why.trim();
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRiskPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function getRiskClass(risk: number): string {
  if (risk >= 70) {
    return "inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700";
  }
  if (risk >= 40) {
    return "inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700";
  }
  return "inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700";
}

const FIRST_SESSION_RATING_THRESHOLD = 3.5;
const FIRST_SESSION_DROPOUT_THRESHOLD = 0.2;
const TUTOR_INITIATED_RESCHEDULE_THRESHOLD = 0.5;
const NO_SHOW_THRESHOLD = 0.1;
const CHURN_RISK_SIGNAL_THRESHOLD = 60;

type TutorSignal = {
  key: string;
  label: string;
  severity: "warning" | "critical";
};

function buildSignalTooltip(signal: TutorSignal, tutor: Tutor): string {
  const { kpis, churn_risk } = tutor;
  switch (signal.key) {
    case "first-session": {
      const rating =
        kpis.first_session_avg_rating === null
          ? "n/a"
          : kpis.first_session_avg_rating.toFixed(2);
      return `First-session rating ${rating}, dropout ${formatPercent(
        kpis.first_session_dropout_rate
      )} across ${kpis.first_session_count} sessions.`;
    }
    case "reschedules":
      return `Tutor-initiated reschedules: ${formatPercent(
        kpis.tutor_initiated_reschedule_rate
      )}.`;
    case "no-shows":
      return `No-show rate: ${formatPercent(kpis.no_show_rate)}.`;
    case "churn":
      return `Projected churn risk: ${formatRiskPercent(churn_risk)}.`;
    default:
      return signal.label;
  }
}

function computeSignals(tutor: Tutor): TutorSignal[] {
  const signals: TutorSignal[] = [];
  const {
    first_session_avg_rating,
    first_session_dropout_rate,
    first_session_count,
    tutor_initiated_reschedule_rate,
    no_show_rate,
  } = tutor.kpis;
  const churnRisk = tutor.churn_risk;

  const firstSessionPoorRating =
    first_session_avg_rating !== null &&
    first_session_avg_rating < FIRST_SESSION_RATING_THRESHOLD;
  const firstSessionHighDropout =
    first_session_dropout_rate > FIRST_SESSION_DROPOUT_THRESHOLD;

  if (
    first_session_count > 0 &&
    (firstSessionPoorRating || firstSessionHighDropout)
  ) {
    signals.push({
      key: "first-session",
      label: "First session issues",
      severity:
        first_session_dropout_rate > 0.3 ||
        (first_session_avg_rating !== null &&
          first_session_avg_rating < FIRST_SESSION_RATING_THRESHOLD - 0.5)
          ? "critical"
          : "warning",
    });
  }

  if (tutor_initiated_reschedule_rate > TUTOR_INITIATED_RESCHEDULE_THRESHOLD) {
    signals.push({
      key: "reschedules",
      label: "Tutor reschedules",
      severity:
        tutor_initiated_reschedule_rate >
        TUTOR_INITIATED_RESCHEDULE_THRESHOLD + 0.15
          ? "critical"
          : "warning",
    });
  }

  if (no_show_rate > NO_SHOW_THRESHOLD) {
    signals.push({
      key: "no-shows",
      label: "No-show risk",
      severity: no_show_rate > NO_SHOW_THRESHOLD + 0.1 ? "critical" : "warning",
    });
  }

  if (churnRisk >= CHURN_RISK_SIGNAL_THRESHOLD) {
    signals.push({
      key: "churn",
      label: "Churn risk",
      severity: churnRisk >= 80 ? "critical" : "warning",
    });
  }

  return signals;
}

export default function AtRiskTable({
  onSelectTutor,
  className,
  subjectFilter,
  scoreThreshold,
  onLoaded,
  resetKey,
}: AtRiskTableProps) {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [formulaVersion, setFormulaVersion] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(25);
  const [sortBy, setSortBy] = useState<"score" | "churn_risk" | null>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const metaRef = useRef<AtRiskTableMeta | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadScores() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/scores", {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const data: ScoresResponse = await response.json();
        if (!isMounted) {
          return;
        }
        const tutorList = Array.isArray(data?.tutors) ? data.tutors : [];
        setTutors(tutorList);
        setGeneratedAt(
          typeof data?.generated_at === "string" ? data.generated_at : null
        );
        setFormulaVersion(
          typeof data?.formula_version === "string"
            ? data.formula_version
            : null
        );
      } catch (err) {
        if (!isMounted) {
          return;
        }
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        setError("Unable to load tutors right now. Please try again later.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadScores();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!onLoaded || !generatedAt) {
      return;
    }

    const explanationsCount = tutors.reduce((count, tutor) => {
      return tutor.explanation ? count + 1 : count;
    }, 0);

    const meta: AtRiskTableMeta = {
      generatedAt,
      explanationsCount,
      formulaVersion,
    };

    if (
      !metaRef.current ||
      metaRef.current.generatedAt !== meta.generatedAt ||
      metaRef.current.explanationsCount !== meta.explanationsCount ||
      metaRef.current.formulaVersion !== meta.formulaVersion
    ) {
      metaRef.current = meta;
      onLoaded(meta);
    }
  }, [generatedAt, tutors, formulaVersion, onLoaded]);

  const filteredTutors = useMemo(() => {
    if (!Array.isArray(tutors)) {
      return [];
    }

    let results = tutors;

    if (subjectFilter && subjectFilter !== "All") {
      results = results.filter((tutor) => tutor.subject === subjectFilter);
    }

    if (typeof scoreThreshold === "number" && !Number.isNaN(scoreThreshold)) {
      results = results.filter((tutor) => tutor.score <= scoreThreshold);
    }

    return results;
  }, [tutors, subjectFilter, scoreThreshold]);

  const sortedTutors = useMemo(() => {
    if (!Array.isArray(filteredTutors)) {
      return [];
    }
    return [...filteredTutors].sort((a, b) => {
      let comparison = 0;

      if (sortBy === "score") {
        comparison = a.score - b.score;
      } else if (sortBy === "churn_risk") {
        comparison = a.churn_risk - b.churn_risk;
      } else {
        // Default: sort by score
        comparison = a.score - b.score;
      }

      // Apply sort direction
      if (sortDirection === "desc") {
        comparison = -comparison;
      }

      // Secondary sort by tutor_id if values are equal
      if (comparison === 0) {
        return a.tutor_id.localeCompare(b.tutor_id);
      }

      return comparison;
    });
  }, [filteredTutors, sortBy, sortDirection]);

  // Reset to page 1 when filters or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [subjectFilter, scoreThreshold, sortBy, sortDirection]);

  // Reset sorting when resetKey changes
  useEffect(() => {
    if (resetKey !== undefined && resetKey > 0) {
      setSortBy("score");
      setSortDirection("asc");
      setCurrentPage(1);
    }
  }, [resetKey]);

  // Pagination logic
  const paginatedTutors = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return sortedTutors.slice(startIndex, endIndex);
  }, [sortedTutors, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedTutors.length / itemsPerPage);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleItemsPerPageChange = useCallback((value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  }, []);

  const handleSort = useCallback(
    (field: "score" | "churn_risk") => {
      if (sortBy === field) {
        // Toggle direction if clicking the same column
        setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      } else {
        // Switch to new column with ascending order
        setSortBy(field);
        setSortDirection("asc");
      }
      setCurrentPage(1); // Reset to first page when sorting changes
    },
    [sortBy, sortDirection]
  );

  const getSortIndicator = useCallback(
    (field: "score" | "churn_risk") => {
      // Always reserve a fixed width for the indicator to prevent shifting
      return (
        <span className="ml-1 inline-flex w-4 items-center justify-center">
          {sortBy !== field ? (
            <svg
              className="h-3 w-3 text-gray-400 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          ) : sortDirection === "asc" ? (
            <svg
              className="h-3 w-3 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          ) : (
            <svg
              className="h-3 w-3 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          )}
        </span>
      );
    },
    [sortBy, sortDirection]
  );

  const handleSelect = useCallback(
    (tutor: Tutor) => {
      if (onSelectTutor) {
        onSelectTutor(tutor);
      }
    },
    [onSelectTutor]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>, tutor: Tutor) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelect(tutor);
      }
    },
    [handleSelect]
  );

  const containerClassName = ["overflow-x-auto", className?.trim() ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClassName}>
      <table className="min-w-[1024px] w-full border-collapse text-sm text-gray-700">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
          <tr className="border-b border-gray-200">
            <th className="px-3 py-3 sm:px-4">Tutor</th>
            <th className="px-3 py-3 sm:px-4">Subject</th>
            <th
              className="px-3 py-3 sm:px-4 cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => handleSort("score")}
            >
              <div className="flex items-center">
                Score
                {getSortIndicator("score")}
              </div>
            </th>
            <th
              className="px-3 py-3 sm:px-4 cursor-pointer hover:bg-gray-100 select-none"
              onClick={() => handleSort("churn_risk")}
            >
              <div className="flex items-center">
                Churn Risk
                {getSortIndicator("churn_risk")}
              </div>
            </th>
            <th className="px-3 py-3 sm:px-4">Signals</th>
            <th className="px-3 py-3 sm:px-4">Why</th>
            <th className="px-3 py-3 sm:px-4">Trend (7d)</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-sm text-gray-500">
                Loading tutors…
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-sm text-red-600">
                {error}
              </td>
            </tr>
          ) : sortedTutors.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-4 text-sm text-gray-500">
                No tutors found.
              </td>
            </tr>
          ) : (
            paginatedTutors.map((tutor) => {
              const signals = computeSignals(tutor);
              return (
                <tr
                  key={tutor.tutor_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(tutor)}
                  onKeyDown={(event) => handleKeyDown(event, tutor)}
                  className={`border-b border-gray-100 transition ${
                    onSelectTutor ? "cursor-pointer hover:bg-gray-50" : ""
                  } focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:bg-gray-50`}
                >
                  <td className="px-3 py-3 font-medium text-gray-900 sm:px-4">
                    {tutor.name}
                  </td>
                  <td className="px-3 py-3 text-gray-600 sm:px-4">
                    {tutor.subject}
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    <span className={getScoreClass(tutor.score)}>
                      {tutor.score}
                    </span>
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    <span className={getRiskClass(tutor.churn_risk)}>
                      {formatRiskPercent(tutor.churn_risk)}
                    </span>
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    {signals.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {signals.map((signal) => (
                          <span
                            key={signal.key}
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                              signal.severity === "critical"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                            title={buildSignalTooltip(signal, tutor)}
                          >
                            {signal.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    <span
                      title={formatWhy(tutor.explanation)}
                      className="block max-w-[320px] truncate text-gray-600"
                    >
                      {formatWhy(tutor.explanation)}
                    </span>
                  </td>
                  <td className="px-3 py-3 sm:px-4">
                    <Sparkline
                      data={tutor.trend_7d}
                      width={120}
                      height={32}
                      stroke="#6d28d9"
                      className="h-8 w-32 sm:h-9 sm:w-36"
                    />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Pagination Controls */}
      {!loading && !error && sortedTutors.length > itemsPerPage && (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Show</span>
            <select
              value={itemsPerPage}
              onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
              className="rounded-md border border-gray-300 pl-2 pr-8 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>per page</span>
            <span className="ml-4 text-gray-500">
              Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
              {Math.min(currentPage * itemsPerPage, sortedTutors.length)} of{" "}
              {sortedTutors.length} tutors
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Previous
            </button>

            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      currentPage === pageNum
                        ? "bg-blue-600 text-white"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
