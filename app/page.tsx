"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";

import AtRiskTable, {
  type AtRiskTableMeta,
  type Tutor,
} from "@/components/AtRiskTable";
import TutorDrawer from "@/components/TutorDrawer";
import type { AiThresholdRecommendation } from "@/types/ai";

export default function Page() {
  const [selectedTutor, setSelectedTutor] = useState<Tutor | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string>("All");
  const [scoreThreshold, setScoreThreshold] = useState<number>(60);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [explanationsCount, setExplanationsCount] = useState<number>(0);
  const [formulaVersion, setFormulaVersion] = useState<string | null>(null);
  const [aiThresholds, setAiThresholds] =
    useState<AiThresholdRecommendation | null>(null);

  const handleSelectTutor = useCallback((tutor: Tutor) => {
    setSelectedTutor(tutor);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedTutor(null);
  }, []);

  const handleSubjectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setSubjectFilter(event.target.value);
    },
    []
  );

  const handleThresholdChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      setScoreThreshold(Number.isNaN(value) ? 0 : value);
    },
    []
  );

  const handleRefresh = useCallback(() => {
    setSelectedTutor(null);
    setRefreshCounter((previous) => previous + 1);
  }, []);

  const handleReset = useCallback(() => {
    setSubjectFilter("All");
    setScoreThreshold(60);
    setSelectedTutor(null);
    setRefreshCounter((previous) => previous + 1);
  }, []);

  const handleTableLoaded = useCallback((meta: AtRiskTableMeta) => {
    setLastUpdated(meta.generatedAt || null);
    setExplanationsCount(meta.explanationsCount ?? 0);
    setFormulaVersion(meta.formulaVersion ?? null);
    setAiThresholds(meta.thresholds ?? null);
  }, []);

  const formattedLastUpdated = useMemo(() => {
    if (!lastUpdated) {
      return "—";
    }

    const timestamp = new Date(lastUpdated);
    if (Number.isNaN(timestamp.getTime())) {
      return lastUpdated;
    }

    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      }).format(timestamp);
    } catch {
      return lastUpdated;
    }
  }, [lastUpdated]);

  const estimatedCost = useMemo(() => {
    return (Math.max(explanationsCount, 0) * 0.02).toFixed(2);
  }, [explanationsCount]);

  const displayFormulaVersion = useMemo(() => {
    const version = formulaVersion ?? "v2";
    if (version === "v1") {
      return "v1.0";
    }
    if (version === "v2") {
      return "v2.0";
    }
    return version;
  }, [formulaVersion]);

  const subjectOptions = useMemo(
    () => ["All", "Math", "Science", "English", "History", "Language Arts"],
    []
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <main className="flex flex-1 flex-col gap-6 pb-10">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-bold text-gray-900">TutorSense</h1>
            <div className="flex flex-col items-end text-sm text-gray-500">
              <span>
                Last updated:{" "}
                <span className="font-semibold text-gray-700">
                  {formattedLastUpdated}
                </span>
              </span>
              <span>
                Scoring formula:{" "}
                <span className="font-semibold text-gray-700">
                  {displayFormulaVersion}
                </span>
              </span>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-gray-600">
            Synthetic tutor performance dashboard showcasing at-risk tutors,
            explanations, and recent trends.
          </p>
          {aiThresholds ? (
            <p className="text-xs text-blue-600">
              Dynamic thresholds (score ≤ {aiThresholds.scoreThreshold}, dropout
              ≥ {aiThresholds.dropoutRateThreshold}%, no-show ≥{" "}
              {aiThresholds.noShowRateThreshold}%).
            </p>
          ) : null}
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Subject
            </span>
            <select
              value={subjectFilter}
              onChange={handleSubjectChange}
              className="mt-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {subjectOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Score threshold (≤ {scoreThreshold})
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={scoreThreshold}
              onChange={handleThresholdChange}
              className="mt-3 w-full accent-blue-600"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 sm:w-auto"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 sm:w-auto"
            >
              Refresh
            </button>
          </div>
        </section>

        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <AtRiskTable
            key={refreshCounter}
            subjectFilter={subjectFilter}
            scoreThreshold={scoreThreshold}
            onSelectTutor={handleSelectTutor}
            onLoaded={handleTableLoaded}
            resetKey={refreshCounter}
          />
        </div>

        <TutorDrawer
          open={Boolean(selectedTutor)}
          selectedTutor={selectedTutor}
          onClose={handleCloseDrawer}
        />

        <footer className="mt-8 border-t border-gray-200 pt-5 text-sm text-gray-600">
          Est. Daily Cost:{" "}
          <span className="font-semibold text-gray-800">${estimatedCost}</span>{" "}
          (based on {explanationsCount} explanations)
        </footer>
      </main>
    </div>
  );
}
