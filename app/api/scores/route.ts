import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import type { TutorKpis } from "@/types/metrics";
import type { TutorAiInsights, AiThresholdRecommendation } from "@/types/ai";

export const revalidate = 0;

type KPIs = TutorKpis;

type Tutor = {
  tutor_id: string;
  name: string;
  subject: string;
  score: number;
  trend_7d: number[];
  kpis: KPIs;
  churn_risk: number;
  ai?: TutorAiInsights;
  explanation?: { why: string; suggested_action: string };
};

type ScoresFile = {
  generated_at: string;
  formula_version?: string;
  ai_thresholds?: AiThresholdRecommendation;
  tutors: Tutor[];
};

type ExplanationMap = Record<
  string,
  {
    why: string;
    suggested_action: string;
  }
>;

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function GET(request: Request) {
  try {
    const scoresPath = path.join(process.cwd(), "public", "scores.json");
    const explanationsPath = path.join(
      process.cwd(),
      "public",
      "explanations.json"
    );

    const [scores, explanations] = await Promise.all([
      readJson<ScoresFile>(scoresPath),
      readJson<ExplanationMap>(explanationsPath).catch(() => ({})),
    ]);

    // MVP requirement: accept but ignore ?date query parameter
    const url = new URL(request.url);
    url.searchParams.get("date");

    const tutors = scores.tutors.map((tutor) => {
      const explanation = (explanations as ExplanationMap)[tutor.tutor_id];
      return explanation ? { ...tutor, explanation } : tutor;
    });

    return NextResponse.json({
      generated_at: scores.generated_at,
      formula_version: scores.formula_version ?? "v1",
      ai_thresholds: scores.ai_thresholds ?? null,
      tutors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching scores";

    return NextResponse.json(
      { error: "Failed to load scores", details: message },
      { status: 503 }
    );
  }
}
