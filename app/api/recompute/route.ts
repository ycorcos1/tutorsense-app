import { NextResponse } from "next/server";

import { runScoringPipeline } from "../../../scripts/score_tutors";

export const revalidate = 0;

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const secret = process.env.RECOMPUTE_SECRET;

  if (!secret) {
    console.error("RECOMPUTE_SECRET is not configured");
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  if (!authHeader.startsWith("Bearer ")) {
    return unauthorizedResponse();
  }

  const providedSecret = authHeader.slice("Bearer ".length).trim();
  if (providedSecret !== secret) {
    return unauthorizedResponse();
  }

  try {
    const summary = await runScoringPipeline();

    return NextResponse.json({
      success: true,
      processed: summary.processed,
      duration_ms: summary.durationMs,
      explanations_generated: summary.explanationsGenerated,
      top_at_risk: summary.topAtRisk,
    });
  } catch (error) {
    console.error("Failed to recompute scores:", error);
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        error: "Failed to recompute scores",
        details,
      },
      { status: 500 }
    );
  }
}
