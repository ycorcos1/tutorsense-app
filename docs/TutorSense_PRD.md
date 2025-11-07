# TutorSense — Product Requirements Document (PRD)

**Version:** 1.1  **Date:** November 2025  
**Owner:** Yahav Corcos  
**Deployment:** Vercel (manual GitHub push)  
**Environment File:** `.env.local` (stores API keys)

---

## 1. Overview

**TutorSense** is an automated scoring system that evaluates tutor performance based on session data, predicts at-risk tutors, and produces actionable insights within one hour of session completion.  
The MVP demonstrates real-time-like analytics using synthetic data and an AI-generated explanation layer.

**Sprint Deliverables**

- ✅ Working prototype deployed to cloud (Vercel)
- ✅ Functional demo using **local synthetic data (Option 1)**
- ✅ AI-assisted text generation (OpenAI or OpenRouter)
- ✅ Documentation + 90-day roadmap + cost analysis
- ✅ Simple React dashboard (simulates Rails/React integration)

---

## 2. Data Source — Local Sample Data (Option 1)

### 2.1 Approach

TutorSense will use **locally stored synthetic data** to simulate real tutor session activity.  
The data will reside inside the `/data/` folder within the project repository.

### 2.2 Files & Schemas

```
/data/
  tutors.csv
  sessions.csv
```

These files are generated using `generate_synthetic_data.ts` and contain fake, but statistically realistic, tutoring data such as ratings, dropouts, reschedules, and technical issues.

#### tutors.csv

| Column      | Type     | Description                                    |
| ----------- | -------- | ---------------------------------------------- |
| `tutor_id`  | string   | Unique identifier (e.g., "T001")               |
| `name`      | string   | Tutor full name                                |
| `subject`   | string   | Primary subject (Math, Science, English, etc.) |
| `hire_date` | ISO date | Date tutor joined platform                     |

#### sessions.csv

| Column             | Type     | Description                                   |
| ------------------ | -------- | --------------------------------------------- |
| `session_id`       | string   | Unique identifier (e.g., "S001")              |
| `tutor_id`         | string   | Foreign key to tutors.csv                     |
| `date`             | ISO date | Session date (last 14 days for trend data)    |
| `duration_minutes` | number   | Session length                                |
| `rating`           | number   | Student rating (1-5 scale, null if no rating) |
| `status`           | enum     | `completed`, `dropout`, or `rescheduled`      |
| `has_tech_issue`   | boolean  | Whether technical issues occurred             |

**Note:** Generate 14 days of historical data to support 7-day trend visualization.

### 2.3 Flow

1. The developer generates the data locally (one-time).
2. The `score_tutors.ts` script reads these files → computes KPIs and AI explanations → writes `/public/scores.json` and `/public/explanations.json`.
3. The frontend dashboard and `/api/scores` endpoint consume those files for visualization.
4. Optionally, a **Vercel Cron** can trigger re-computation daily to simulate ongoing updates.

### 2.4 Benefits

- Zero user setup or upload requirement.
- Works seamlessly in both local dev and Vercel deployment.
- Reproducible, predictable data for demo.
- No external storage or Firebase dependency.

---

## 3. Goals & Success Criteria

**Primary Goal:** Provide a daily dashboard that automatically flags tutors who may require coaching and explains why.

**Success metrics:**

- Score and flag all tutors (< 3,000 sessions/day) within 10 minutes (batch < 1 h SLA).
- Generate concise LLM explanations for tutors scoring below threshold (score < 60 or bottom 20%, max 50 explanations).
- Display a clear, interactive dashboard of tutors and KPIs.
- Fully deployed on Vercel with a single cron job or manual recompute.

---

## 4. Functional Scope

### Core Features

1. **Synthetic Data Generator**

   - Creates local CSV datasets in `/data/` folder.
   - Generates 14 days of historical data for trend analysis.
   - Includes distributions for ratings, dropouts, technical issues, and reschedules.
   - Produces ~200 tutors with ~3,000 sessions total across the time period.

2. **Scoring Engine**

   - Reads CSVs, aggregates per-tutor KPIs, and assigns a score (0–100).
   - **Scoring Formula:**

     ```
     Score = 100 - (dropout_penalty + issue_penalty + reschedule_penalty + rating_penalty)

     Where:
     - dropout_penalty = dropout_rate × 40
     - issue_penalty = tech_issue_rate × 30
     - reschedule_penalty = reschedule_rate × 20
     - rating_penalty = (5 - avg_rating) × 10

     Final score is clamped to [0, 100]
     ```

   - Calculates 7-day rolling trends for each tutor.

3. **AI Explanation Layer**

   - Integrated into scoring pipeline (not a separate endpoint).
   - Generates explanations for tutors with score < 60 OR bottom 20% (max 50 per batch).
   - Summarizes reasons and suggests coaching tips using LLM (OpenAI or OpenRouter).
   - Falls back to deterministic templates if API key missing.
   - Outputs cached to `/public/explanations.json`.
   - **Cost estimate:** ~$0.50-$1.00 per batch (50 tutors × ~500 tokens each).

4. **API Endpoints**

   **GET /api/scores**

   - Returns merged data from `scores.json` + `explanations.json`.
   - Optional query param: `?date=YYYY-MM-DD` (MVP: ignored, always returns latest).
   - Response schema:
     ```typescript
     {
       "generated_at": "2025-11-06T10:00:00Z",
       "tutors": [
         {
           "tutor_id": "T001",
           "name": "John Doe",
           "subject": "Math",
           "score": 45,
           "trend_7d": [52, 48, 50, 47, 46, 44, 45],
           "kpis": {
             "avg_rating": 3.2,
             "dropout_rate": 0.15,
             "tech_issue_rate": 0.20,
             "reschedule_rate": 0.10,
             "sessions_count": 42
           },
           "explanation": {
             "why": "High technical issues (20%) and low ratings",
             "suggested_action": "Provide technical training and review session quality"
           }
         }
       ]
     }
     ```

   **GET /api/tutor/[id]**

   - Returns detailed time-series data for a single tutor.
   - Response includes 14 days of historical scores and KPIs.

   **POST /api/recompute**

   - Reruns scoring + explanation pipeline.
   - **Authentication:** Requires header `Authorization: Bearer ${RECOMPUTE_SECRET}`
   - Returns 401 if missing/incorrect.
   - Response schema:
     ```typescript
     {
       "success": true,
       "processed": 200,
       "duration_ms": 45000,
       "explanations_generated": 38,
       "top_at_risk": [
         { "tutor_id": "T123", "name": "John Doe", "score": 32 },
         // ... up to 5 total
       ]
     }
     ```

5. **Frontend Dashboard**

   - **Table view:** Displays tutor name, subject, score chip (color-coded), one-line "why", and 7-day trend sparkline.
   - **Score color-coding:** Green (> 80), Yellow (60-80), Red (< 60).
   - **Drawer panel:** Opens on row click, shows detailed KPIs and full explanation with suggested action.
   - **Header:** Logo, last-updated timestamp, date picker (UI-only for MVP), refresh button.
   - **Filters:**
     - Subject dropdown (All, Math, Science, English, etc.)
     - Score threshold slider (0-100, default: 60) — shows only tutors ≤ threshold
   - **Refresh button:** Re-fetches `/api/scores` (does NOT trigger recompute).
   - **Footer:** Displays estimated daily cost (e.g., "Est. Daily Cost: $0.75 based on 38 explanations").
   - **Sorting:** Default sort by score ascending (worst tutors first).

6. **Batch Pipeline**
   - Executes nightly via Vercel Cron (02:00 UTC) or manually via `/api/recompute`.
   - Generates `/public/scores.json` and `/public/explanations.json`.
   - Logs execution time, tokens used, and tutors processed.

---

## 5. Environment Setup

**Prerequisites**

- Node 18 + PNPM or Yarn
- Vercel + GitHub integration
- `.env.local` containing:
  ```
  OPENAI_API_KEY=sk-xxxx
  OPENROUTER_API_KEY=sk-xxxx
  RECOMPUTE_SECRET=any-secret-string
  ```

**Installation**

```bash
pnpm create next-app@latest tutorsense
cd tutorsense
pnpm add openai@^4.0.0 papaparse zod
pnpm add -D typescript @types/papaparse @types/node tsx
```

**Folder Structure**

```
/data/
  tutors.csv
  sessions.csv
/scripts/
  generate_synthetic_data.ts
  score_tutors.ts
/app/api/scores/route.ts
/app/api/tutor/[id]/route.ts
/app/api/recompute/route.ts
/app/page.tsx
/components/
  AtRiskTable.tsx
  TutorDrawer.tsx
  Sparkline.tsx
/public/
  scores.json
  explanations.json
/tests/
  score.test.ts
vercel.json
```

---

## 6. System Architecture

**High-Level Flow**

```
/data/*.csv → Scoring Engine (with AI) → /public/*.json → API → Dashboard
```

1. Local synthetic data (14 days) resides in `/data/`.
2. `score_tutors.ts` aggregates KPIs, computes scores, generates AI explanations → writes `scores.json` + `explanations.json`.
3. Dashboard fetches merged data via `/api/scores`.
4. Vercel Cron re-runs scoring daily at 02:00 UTC.

---

## 7. Deployment Plan

1. Push project to GitHub → connected to Vercel.
2. Add `.env.local` variables in Vercel settings (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `RECOMPUTE_SECRET`).
3. Commit generated data and initial scores to repo.
4. Verify that `/api/scores` serves properly.
5. Deploy main branch → accessible at `https://tutorsense.vercel.app`.
6. Add `vercel.json` for cron configuration:
   ```json
   {
     "crons": [
       {
         "path": "/api/recompute",
         "schedule": "0 2 * * *"
       }
     ]
   }
   ```
7. Ensure `RECOMPUTE_SECRET` is set in Vercel environment (cron will use internal auth).

---

## 8. Security & Privacy

- Synthetic data only — no PII.
- API keys stored server-side only (Vercel environment variables).
- `/api/recompute` secured via `Authorization: Bearer ${RECOMPUTE_SECRET}` header.
- LLM usage rate-limited to max 50 explanations per batch.

### Error Handling

- **If OpenAI API fails:** Use fallback deterministic templates based on KPI thresholds.
- **If scoring script fails:** Log error, preserve previous `scores.json`, display stale data warning in UI.
- **Frontend API unavailable:** Show "Unable to load data" message with last-updated timestamp.
- **Display last-updated timestamp** in dashboard header to indicate data freshness.

---

## 9. Definition of Done

✅ Local synthetic data generated and used via `/data/`.  
✅ Deployed app on Vercel showing real scores and explanations.  
✅ Fully functional At-Risk dashboard.  
✅ Manual recompute and optional Cron job.  
✅ Test coverage and schema validation.  
✅ 5-minute demo and roadmap delivered.
