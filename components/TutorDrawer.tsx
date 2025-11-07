"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PerformanceTrendChart from "./PerformanceTrendChart";
import type { Tutor } from "./AtRiskTable";
import type { AiThresholdRecommendation } from "@/types/ai";

type KPIs = Tutor["kpis"];
type AiInsights = Tutor["ai"];

type Explanation = NonNullable<Tutor["explanation"]>;

type TutorDay = {
  date: string;
  score: number;
  kpis: KPIs;
};

type TutorDetailResponse = {
  tutor_id: string;
  name: string;
  subject: string;
  summary: {
    score: number;
    trend_7d: number[];
    kpis: KPIs;
    churn_risk: number;
  };
  ai?: AiInsights;
  ai_thresholds?: AiThresholdRecommendation | null;
  explanation?: Explanation;
  days: TutorDay[];
  generated_at: string;
  formula_version: string;
};

type TutorDrawerProps = {
  open: boolean;
  selectedTutor: Tutor | null;
  onClose: () => void;
};

type DrawerState = {
  detail: TutorDetailResponse | null;
  loading: boolean;
  error: string | null;
};

function getScoreChipClass(score: number): string {
  const baseClasses =
    "inline-flex min-w-[3.25rem] items-center justify-center rounded-full px-3 py-1 text-sm font-semibold border";

  if (score < 60) {
    return `${baseClasses} border-red-200 bg-red-50 text-red-700`;
  }

  if (score < 80) {
    return `${baseClasses} border-amber-200 bg-amber-50 text-amber-700`;
  }

  return `${baseClasses} border-green-200 bg-green-50 text-green-700`;
}

function formatPercent(value: number | undefined, fractionDigits = 1): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${(value! * 100).toFixed(fractionDigits)}%`;
}

function formatRating(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(2);
}

function formatNumber(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value!.toLocaleString();
}

function formatRiskPercentValue(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

const FIRST_SESSION_RATING_THRESHOLD = 3.5;
const FIRST_SESSION_DROPOUT_THRESHOLD = 0.2;
const TUTOR_INITIATED_RESCHEDULE_THRESHOLD = 0.5;
const NO_SHOW_THRESHOLD = 0.1;
const CHURN_RISK_SIGNAL_THRESHOLD = 60;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function TutorDrawer({
  open,
  selectedTutor,
  onClose,
}: TutorDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [{ detail, loading, error }, setDrawerState] = useState<DrawerState>({
    detail: null,
    loading: false,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const selectedTutorId = selectedTutor?.tutor_id ?? null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setDrawerState({ detail: null, loading: false, error: null });
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !selectedTutorId) {
      return;
    }

    const tutorIdValue = selectedTutorId as string;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    let isActive = true;

    async function loadTutorDetail() {
      setDrawerState((prev) => ({
        detail:
          prev.detail && prev.detail.tutor_id === tutorIdValue
            ? prev.detail
            : null,
        loading: true,
        error: null,
      }));

      try {
        const response = await fetch(
          `/api/tutor/${encodeURIComponent(tutorIdValue)}`,
          {
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data: TutorDetailResponse = await response.json();

        if (!isActive) {
          return;
        }

        setDrawerState({ detail: data, loading: false, error: null });
      } catch (err) {
        if (!isActive) {
          return;
        }
        if ((err as Error)?.name === "AbortError") {
          return;
        }
        setDrawerState({
          detail: null,
          loading: false,
          error: "Unable to load tutor details right now.",
        });
      }
    }

    loadTutorDetail();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [open, selectedTutorId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const button = closeButtonRef.current;
    if (button) {
      const id = requestAnimationFrame(() => {
        button.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open, selectedTutorId]);

  const summaryScore = useMemo(() => {
    if (detail?.summary?.score !== undefined) {
      return detail.summary.score;
    }
    return selectedTutor?.score ?? null;
  }, [detail?.summary?.score, selectedTutor?.score]);

  const summaryTrend = useMemo(() => {
    if (detail?.summary?.trend_7d && detail.summary.trend_7d.length > 0) {
      return detail.summary.trend_7d;
    }
    return selectedTutor?.trend_7d ?? [];
  }, [detail?.summary?.trend_7d, selectedTutor?.trend_7d]);

  const summaryKPIs: KPIs | null = useMemo(() => {
    if (detail?.summary?.kpis) {
      return detail.summary.kpis;
    }
    return selectedTutor?.kpis ?? null;
  }, [detail?.summary?.kpis, selectedTutor?.kpis]);

  const explanation: Explanation | null = useMemo(() => {
    if (detail?.explanation) {
      return detail.explanation;
    }
    return selectedTutor?.explanation ?? null;
  }, [detail?.explanation, selectedTutor?.explanation]);

  const dailySeries = detail?.days ?? [];

  const churnRisk =
    detail?.summary?.churn_risk ?? selectedTutor?.churn_risk ?? null;
  const detailFormulaVersion = detail?.formula_version ?? null;

  const aiInsights: AiInsights | null = useMemo(() => {
    if (detail?.ai) {
      return detail.ai;
    }
    return selectedTutor?.ai ?? null;
  }, [detail?.ai, selectedTutor?.ai]);

  const aiThresholds: AiThresholdRecommendation | null = useMemo(() => {
    if (detail?.ai_thresholds) {
      return detail.ai_thresholds;
    }
    if (detail?.ai?.thresholdRecommendation) {
      return detail.ai.thresholdRecommendation;
    }
    if (selectedTutor?.ai?.thresholdRecommendation) {
      return selectedTutor.ai.thresholdRecommendation;
    }
    return null;
  }, [detail?.ai_thresholds, detail?.ai, selectedTutor?.ai]);

  const kpiItems = useMemo(() => {
    if (!summaryKPIs) {
      return [];
    }

    const metrics = summaryKPIs;
    const items: Array<{ label: string; value: string }> = [];

    items.push({
      label: "Churn Risk",
      value: churnRisk === null ? "—" : formatRiskPercentValue(churnRisk),
    });

    items.push({
      label: "Avg Rating",
      value: formatRating(metrics.avg_rating),
    });
    items.push({
      label: "Dropout %",
      value: formatPercent(metrics.dropout_rate),
    });
    items.push({
      label: "Tech Issue %",
      value: formatPercent(metrics.tech_issue_rate),
    });
    items.push({
      label: "Reschedule %",
      value: formatPercent(metrics.reschedule_rate),
    });
    items.push({
      label: "Sessions (14d)",
      value: formatNumber(metrics.sessions_count),
    });

    if (metrics.first_session_count > 0) {
      items.push({
        label: "First Session Avg",
        value: formatRating(metrics.first_session_avg_rating),
      });
      items.push({
        label: "First Session Dropout",
        value: formatPercent(metrics.first_session_dropout_rate),
      });
    }

    items.push({
      label: "Tutor Reschedule %",
      value: formatPercent(metrics.tutor_initiated_reschedule_rate),
    });
    items.push({
      label: "No-Show %",
      value: formatPercent(metrics.no_show_rate),
    });

    return items;
  }, [summaryKPIs, churnRisk]);

  const riskSignals = useMemo(() => {
    if (!summaryKPIs) {
      return [] as Array<{ label: string; detail: string }>;
    }

    const signals: Array<{ label: string; detail: string }> = [];
    const metrics = summaryKPIs;

    const firstSessionPoorRating =
      metrics.first_session_avg_rating !== null &&
      metrics.first_session_avg_rating < FIRST_SESSION_RATING_THRESHOLD;
    const firstSessionHighDropout =
      metrics.first_session_dropout_rate > FIRST_SESSION_DROPOUT_THRESHOLD;

    if (
      metrics.first_session_count > 0 &&
      (firstSessionPoorRating || firstSessionHighDropout)
    ) {
      signals.push({
        label: "First session issues",
        detail: `Avg ${formatRating(
          metrics.first_session_avg_rating
        )}, dropout ${formatPercent(
          metrics.first_session_dropout_rate
        )} across ${formatNumber(metrics.first_session_count)} sessions`,
      });
    }

    if (
      metrics.tutor_initiated_reschedule_rate >
      TUTOR_INITIATED_RESCHEDULE_THRESHOLD
    ) {
      signals.push({
        label: "High tutor-initiated reschedules",
        detail: `${formatPercent(
          metrics.tutor_initiated_reschedule_rate
        )} tutor-driven reschedules`,
      });
    }

    if (metrics.no_show_rate > NO_SHOW_THRESHOLD) {
      signals.push({
        label: "No-show risk",
        detail: `${formatPercent(metrics.no_show_rate)} of sessions`,
      });
    }

    if (churnRisk !== null && churnRisk >= CHURN_RISK_SIGNAL_THRESHOLD) {
      signals.push({
        label: "High churn risk",
        detail: `Projected churn risk ${formatRiskPercentValue(churnRisk)}.`,
      });
    }

    return signals;
  }, [summaryKPIs, churnRisk]);

  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const stopPropagation = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
    },
    []
  );

  if (!mounted || !open || !selectedTutor) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full max-w-full bg-white shadow-2xl transition duration-200 sm:w-[480px] md:w-[520px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutor-drawer-title"
        onClick={stopPropagation}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
            <header className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div className="space-y-2">
                <p className="text-sm text-gray-500">{selectedTutor.subject}</p>
                <h2
                  id="tutor-drawer-title"
                  className="text-2xl font-semibold text-gray-900"
                >
                  {selectedTutor.name}
                </h2>
                {summaryScore !== null ? (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-3">
                      <span className={getScoreChipClass(summaryScore)}>
                        Overall Score: {summaryScore}
                      </span>
                      {summaryTrend.length > 0 && (
                        <span
                          className={getScoreChipClass(
                            summaryTrend[summaryTrend.length - 1]
                          )}
                        >
                          Latest: {summaryTrend[summaryTrend.length - 1]}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      Overall score includes all sessions from the last 14 days.
                      Latest score shows the most recent day's performance.
                    </p>
                  </div>
                ) : null}
                {detailFormulaVersion ? (
                  <p className="text-xs text-gray-500">
                    Formula{" "}
                    {detailFormulaVersion === "v1"
                      ? "v1.0"
                      : detailFormulaVersion === "v2"
                      ? "v2.0"
                      : detailFormulaVersion}
                  </p>
                ) : null}
                {aiInsights ? (
                  <p className="text-xs text-indigo-600">
                    AI churn {(aiInsights.churnProbability * 100).toFixed(0)}% ·
                    Forecast {aiInsights.forecast.trajectory}
                  </p>
                ) : null}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                Close
              </button>
            </header>

            <section className="space-y-4">
              <h3 className="text-base font-semibold text-gray-900">
                Key Metrics (last 14 days)
              </h3>
              {kpiItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {kpiItems.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4"
                    >
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {item.label}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-gray-900">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Metrics unavailable.</p>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-gray-900">
                Risk Signals
              </h3>
              {riskSignals.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No major risk signals detected in the last 14 days.
                </p>
              ) : (
                <ul className="space-y-2 text-sm text-gray-700">
                  {riskSignals.map((signal) => (
                    <li
                      key={signal.label}
                      className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-800"
                    >
                      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />
                      <div>
                        <p className="font-semibold">{signal.label}</p>
                        <p>{signal.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {aiInsights ? (
              <section className="space-y-4">
                <h3 className="text-base font-semibold text-gray-900">
                  AI Insights
                </h3>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-4 text-indigo-900">
                  <p className="text-sm font-semibold">Summary</p>
                  <p className="mt-1 text-sm">{aiInsights.summary}</p>
                  <p className="mt-2 text-xs">
                    Churn probability{" "}
                    {(aiInsights.churnProbability * 100).toFixed(0)}% (
                    {(aiInsights.churnConfidence * 100).toFixed(0)}% confidence)
                    · Anomaly score {(aiInsights.anomalyScore * 100).toFixed(0)}
                    %
                  </p>
                  <p className="mt-1 text-xs">
                    {aiInsights.forecast.description} (confidence
                    {(aiInsights.forecast.confidence * 100).toFixed(0)}%)
                  </p>
                </div>
                {aiInsights.persona ? (
                  <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-sm font-semibold text-gray-900">
                      Persona: {aiInsights.persona.label}
                    </p>
                    <p className="mt-1 text-sm text-gray-700">
                      {aiInsights.persona.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        Strengths: {aiInsights.persona.strengths.join(", ")}
                      </span>
                      <span>Risks: {aiInsights.persona.risks.join(", ")}</span>
                    </div>
                  </div>
                ) : null}
                {aiInsights.interventions.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-gray-900">
                      Recommended interventions
                    </h4>
                    <ul className="space-y-2">
                      {aiInsights.interventions.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-gray-900">
                              {item.title}
                            </span>
                            <span className="text-xs text-indigo-600">
                              {(item.effectiveness * 100).toFixed(0)}% impact ·
                              Effort {item.effort}
                            </span>
                          </div>
                          <p className="mt-1">{item.description}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {item.rationale}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <details className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <summary className="cursor-pointer font-semibold text-gray-900">
                    AI Coaching Plan
                  </summary>
                  <div className="mt-4 space-y-4 text-sm text-gray-700">
                    {/* Title */}
                    <h4 className="text-base font-semibold text-gray-900">
                      Coaching Playbook for {selectedTutor.name}
                    </h4>

                    {/* AI Summary */}
                    <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2">
                      <p className="font-semibold text-indigo-900">
                        AI Summary
                      </p>
                      <p className="mt-1 text-indigo-800">
                        {aiInsights.summary}
                      </p>
                    </div>

                    {/* Top Priorities */}
                    <div>
                      <p className="font-semibold text-gray-900">
                        Top Priorities
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {aiInsights.signals.slice(0, 3).map((signal, index) => (
                          <li key={index}>{signal}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Intervention Roadmap */}
                    <div>
                      <p className="font-semibold text-gray-900">
                        Intervention Roadmap
                      </p>
                      <div className="mt-2 space-y-3">
                        {aiInsights.interventions.map((intervention, index) => (
                          <div
                            key={intervention.id}
                            className="rounded-md border border-gray-200 bg-white px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-gray-900">
                                {index + 1}. {intervention.title}
                              </p>
                            </div>
                            <div className="mt-2 space-y-1 text-xs">
                              <p>
                                <span className="font-medium">
                                  Effectiveness:
                                </span>{" "}
                                {(intervention.effectiveness * 100).toFixed(0)}%
                              </p>
                              <p>
                                <span className="font-medium">Effort:</span>{" "}
                                {intervention.effort}
                              </p>
                              <p>
                                <span className="font-medium">Why:</span>{" "}
                                {intervention.rationale}
                              </p>
                              <p>
                                <span className="font-medium">Action:</span>{" "}
                                {intervention.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Forecast Insight */}
                    <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
                      <p className="font-semibold text-blue-900">
                        Forecast Insight
                      </p>
                      <p className="mt-1 text-blue-800">
                        {aiInsights.forecast.description}
                      </p>
                      <p className="mt-1 text-xs text-blue-700">
                        Confidence:{" "}
                        {(aiInsights.forecast.confidence * 100).toFixed(0)}%
                      </p>
                    </div>

                    {/* Persona Guidance */}
                    {aiInsights.persona && (
                      <div>
                        <p className="font-semibold text-gray-900">
                          Persona Guidance
                        </p>
                        <div className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2">
                          <p>
                            <span className="font-medium">Profile:</span>{" "}
                            {aiInsights.persona.label}
                          </p>
                          <p className="mt-1">
                            <span className="font-medium">Description:</span>{" "}
                            {aiInsights.persona.description}
                          </p>
                          <p className="mt-1">
                            <span className="font-medium">Strengths:</span>{" "}
                            {aiInsights.persona.strengths.join(", ")}
                          </p>
                          <p className="mt-1">
                            <span className="font-medium">Risks:</span>{" "}
                            {aiInsights.persona.risks.join(", ")}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Next Review */}
                    <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
                      <p className="font-semibold text-amber-900">
                        Next Review
                      </p>
                      <p className="mt-1 text-amber-800">
                        Schedule follow-up in 7 days to review forecast accuracy
                        and intervention progress.
                      </p>
                    </div>
                  </div>
                </details>
                {aiThresholds ? (
                  <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <p>
                      <strong>Dynamic thresholds:</strong> Score ≤{" "}
                      {aiThresholds.scoreThreshold}, dropout ≥{" "}
                      {aiThresholds.dropoutRateThreshold}%, no-show ≥{" "}
                      {aiThresholds.noShowRateThreshold}%.
                    </p>
                    <p className="mt-1">{aiThresholds.rationale}</p>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Performance Trend (7 days)
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  Daily score changes over the last 7 days. Each day's score is
                  calculated independently from that day's sessions only. This
                  shows recent performance trends, which may differ from the
                  overall 14-day score above.
                </p>
              </div>
              <PerformanceTrendChart
                data={summaryTrend}
                width={420}
                height={200}
                stroke="#2563eb"
                fill="#dbeafe"
              />
            </section>

            {dailySeries.length > 0 ? (
              <section className="space-y-4">
                <h3 className="text-base font-semibold text-gray-900">
                  14-Day Daily Scores
                </h3>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                      <tr>
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2">Score</th>
                        <th className="px-4 py-2">Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailySeries.map((day) => {
                        const hasSessions = day.kpis.sessions_count > 0;
                        const hasDropouts = day.kpis.dropout_rate > 0;

                        // Determine row styling
                        let rowClass = "border-b border-gray-100 last:border-0";
                        let statusBadge = null;

                        if (!hasSessions) {
                          // No sessions - muted gray background
                          rowClass += " bg-gray-50";
                          statusBadge = (
                            <span className="ml-2 text-xs text-gray-500 italic">
                              (No sessions)
                            </span>
                          );
                        } else if (hasDropouts) {
                          // Sessions with dropouts - light red background
                          rowClass += " bg-red-50";
                          statusBadge = (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                              {Math.round(day.kpis.dropout_rate * 100)}% dropout
                            </span>
                          );
                        } else {
                          // Sessions without dropouts - normal
                          rowClass += " bg-white";
                        }

                        return (
                          <tr key={day.date} className={rowClass}>
                            <td className="px-4 py-2 text-gray-600">
                              {formatDate(day.date)}
                            </td>
                            <td className="px-4 py-2 text-gray-700">
                              {day.score}
                              {statusBadge}
                            </td>
                            <td className="px-4 py-2 text-gray-700">
                              {hasSessions ? (
                                <span className="font-medium">
                                  {formatNumber(day.kpis.sessions_count)}
                                </span>
                              ) : (
                                <span className="text-gray-400 italic">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="space-y-3">
              <h3 className="text-base font-semibold text-gray-900">
                Coaching Guidance
              </h3>
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Why</p>
                  <p className="mt-1 text-sm text-gray-700">
                    {explanation?.why?.trim() ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Suggested Action
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    {explanation?.suggested_action?.trim() ?? "—"}
                  </p>
                </div>
              </div>
            </section>

            {loading ? (
              <p className="text-sm text-gray-500">Loading tutor details…</p>
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      </aside>
    </>
  );
}
