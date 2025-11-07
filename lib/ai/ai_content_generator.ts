import type {
  AiInterventionRecommendation,
  TutorAiInsights,
} from "../../types/ai";

export function buildCoachingPlan(
  insights: TutorAiInsights,
  tutorName: string
): string {
  const lines: string[] = [];
  lines.push(`# Coaching Playbook for ${tutorName}`);
  lines.push("");
  lines.push(`**AI Summary:** ${insights.summary}`);
  lines.push("");
  lines.push("## Top Priorities");
  lines.push("-");
  insights.signals.slice(0, 3).forEach((signal) => {
    lines.push(`- ${signal}`);
  });
  lines.push("");
  lines.push("## Intervention Roadmap");
  insights.interventions.forEach((intervention, index) => {
    lines.push(`### ${index + 1}. ${intervention.title}`);
    lines.push(`- **Effectiveness**: ${(intervention.effectiveness * 100).toFixed(0)}%`);
    lines.push(`- **Effort**: ${intervention.effort}`);
    lines.push(`- **Why**: ${intervention.rationale}`);
    lines.push(`- **Action**: ${intervention.description}`);
    lines.push("");
  });
  lines.push("## Forecast Insight");
  lines.push(`- ${insights.forecast.description}`);
  lines.push(`- Confidence: ${(insights.forecast.confidence * 100).toFixed(0)}%`);
  lines.push("");
  lines.push("## Persona Guidance");
  if (insights.persona) {
    lines.push(`- **Profile**: ${insights.persona.label}`);
    lines.push(`- **Description**: ${insights.persona.description}`);
    lines.push(`- **Strengths**: ${insights.persona.strengths.join(", ")}`);
    lines.push(`- **Risks**: ${insights.persona.risks.join(", ")}`);
  } else {
    lines.push("- No persona classification available.");
  }
  lines.push("");
  lines.push("## Next Review");
  lines.push("- Schedule follow-up in 7 days to review forecast accuracy and intervention progress.");

  return lines.join("\n");
}

export function generateInterventionNotes(
  interventions: AiInterventionRecommendation[]
): string {
  return interventions
    .map((intervention, index) => {
      return `${index + 1}. ${intervention.title} — ${(intervention.effectiveness * 100).toFixed(0)}% expected impact. ${intervention.rationale}`;
    })
    .join("\n");
}
