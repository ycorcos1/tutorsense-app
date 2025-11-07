# TutorSense — Task List

**Version:** 1.0  
**Owner:** Yahav Corcos  
**Goal:** Build and deploy a working MVP of TutorSense on Vercel using local synthetic data

---

## 🧩 Phase 1 — Project Setup & Environment

### Task 1: Project Initialization

- Create a new Next.js 13 App Router project (`pnpm create next-app@latest tutorsense`).
- Initialize GitHub repository and connect to Vercel.
- Add `.env.local` with:
  ```
  OPENAI_API_KEY=
  OPENROUTER_API_KEY=
  RECOMPUTE_SECRET=
  ```
- Commit initial project scaffold.

### Task 2: Folder Structure Setup

- Create project directories:
  ```
  /data
  /scripts
  /components
  /app/api
  /tests
  /public
  ```
- Add placeholder files for `/app/page.tsx`, `/scripts/score_tutors.ts`, `/components/AtRiskTable.tsx`, etc.
- Verify local dev server runs without errors (`pnpm dev`).

---

## 🧪 Phase 2 — Data Generation & Scoring Logic

### Task 3: Generate Synthetic Data File

- Implement `/scripts/generate_synthetic_data.ts`.
- Use Faker or similar library to output two CSVs:
  ```
  /data/tutors.csv
  /data/sessions.csv
  ```
- **CSV Schemas:**
  - `tutors.csv`: tutor_id, name, subject, hire_date
  - `sessions.csv`: session_id, tutor_id, date, duration_minutes, rating, status, has_tech_issue
- Simulate 200 tutors, ~3,000 sessions total across **14 days** (for 7-day trend analysis).
- Include realistic distributions:
  - Ratings: mostly 4-5, some 3, few 1-2
  - Status: 80% completed, 10% dropout, 10% rescheduled
  - Technical issues: 5-15% of sessions
- Validate that files can be read without parse errors.

### Task 4: Implement Scoring Engine

- Create `/scripts/score_tutors.ts`:
  - Parse the CSV files using Papaparse.
  - Aggregate KPIs per tutor: avg rating, dropout %, issue %, reschedules %, sessions count.
  - Compute composite score (0–100) using formula:
    ```
    Score = 100 - (dropout_rate × 40 + tech_issue_rate × 30
                   + reschedule_rate × 20 + (5 - avg_rating) × 10)
    Clamp to [0, 100]
    ```
  - Calculate 7-day rolling trend for each tutor (last 7 days of scores).
  - Write results to `/public/scores.json`.
- Include timestamp and metadata in output file.

### Task 5: Integrate AI Explanation Layer

- **Integrate into `score_tutors.ts` script** (not a separate API endpoint).
- After scoring, identify tutors with score < 60 OR bottom 20% (whichever gives fewer, max 50).
- For each at-risk tutor, call OpenAI or OpenRouter to generate:
  - One-line "why" explanation
  - "Suggested action" for coaching
- Use prompt template with tutor KPIs as context.
- Implement fallback deterministic templates when API key is missing or rate limits hit.
- Cache outputs to `/public/explanations.json`.
- Track token usage and estimated cost.

---

## 🧠 Phase 3 — Backend API

### Task 6: Scores API

- Create `/app/api/scores/route.ts` to return merged data from `scores.json` + `explanations.json`.
- Support optional query param `?date=YYYY-MM-DD` (for MVP: ignore and always return latest).
- Return JSON matching schema:
  ```typescript
  {
    generated_at: ISO timestamp,
    tutors: [{
      tutor_id, name, subject, score, trend_7d: number[],
      kpis: { avg_rating, dropout_rate, tech_issue_rate, reschedule_rate, sessions_count },
      explanation?: { why, suggested_action }
    }]
  }
  ```
- Handle case where explanation doesn't exist for some tutors (only at-risk have explanations).

### Task 7: Tutor Details API

- Create `/app/api/tutor/[id]/route.ts` returning detailed time-series data for a single tutor.
- Include 14-day historical scores and KPIs.
- Return 404 if tutor_id not found.

### Task 8: Recompute API

- Implement `/app/api/recompute/route.ts`:
  - **Authentication:** Check header `Authorization: Bearer ${RECOMPUTE_SECRET}`
  - Return 401 Unauthorized if missing or incorrect
  - Runs `score_tutors.ts` script (which includes scoring + explanation generation)
  - Returns summary JSON:
    ```typescript
    {
      success: true,
      processed: 200,
      duration_ms: 45000,
      explanations_generated: 38,
      top_at_risk: [
        { tutor_id: "T123", name: "John Doe", score: 32 },
        // ... up to 5 tutors
      ]
    }
    ```
  - Handle errors gracefully (preserve old scores.json if script fails)

---

## 💻 Phase 4 — Frontend Dashboard

### Task 9: At-Risk Table Component

- Build `/components/AtRiskTable.tsx`.
- Display columns: Tutor Name, Subject, Score chip (color-coded), "Why" explanation, 7-day trend sparkline.
- **Color coding:** Green (> 80), Yellow (60-80), Red (< 60).
- Fetch data from `/api/scores`.
- Sort tutors by score ascending (worst first).
- Make rows clickable to open TutorDrawer.

### Task 10: Tutor Drawer Component

- Build `/components/TutorDrawer.tsx`.
- Display detailed KPIs: Avg Rating, Dropout %, Tech Issue %, Reschedule %, Sessions Count.
- Show 7-day trend chart (more detailed than sparkline).
- Display full "Why" explanation and "Suggested Action" text.
- Opens as side panel on row click.
- Include close button and tutor name in header.

### Task 11: Main Page Layout

- Build `/app/page.tsx`:
  - **Header:**
    - Logo/title ("TutorSense")
    - Last-updated timestamp
    - Date picker (UI-only for MVP, doesn't filter data)
    - Refresh button (re-fetches `/api/scores`, does NOT trigger recompute)
  - Integrate `AtRiskTable` + `TutorDrawer`.
  - **Filters:**
    - Subject dropdown: All, Math, Science, English, etc.
    - Score threshold slider: 0-100, default 60, filters table to show tutors ≤ threshold
  - **Footer:**
    - Display estimated daily cost: "Est. Daily Cost: $X.XX (based on N explanations)"
    - Use formula: ~$0.50-$1.00 per 50 explanations
  - Show loading states and error messages appropriately.

### Task 12: Responsive Design and Styling

- Add Tailwind CSS (recommended) or CSS modules.
- Ensure layout adapts for tablet (768px+) and desktop (1024px+).
- Implement consistent color-coding for scores:
  - **Green:** score > 80
  - **Yellow:** score 60-80
  - **Red:** score < 60
- Make table scrollable on mobile.
- Ensure drawer overlays properly on all screen sizes.

---

## 🧾 Phase 5 — Automation & Deployment

### Task 13: Nightly Recompute Job

- Create `vercel.json` in project root:
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
- Ensure `RECOMPUTE_SECRET` is set in Vercel environment variables.
- Note: Vercel Cron has built-in authentication, but endpoint still checks header for manual calls.
- Validate logs show successful recomputation after deployment.

### Task 14: Local Testing and Validation

- Add `/tests/score.test.ts` to validate scoring math:
  - Test scoring formula with known inputs
  - Verify score clamping to [0, 100]
  - Test edge cases (no sessions, missing ratings, etc.)
- Write a schema-validation test for `scores.json` using Zod.
- Test that CSV parsing handles malformed data gracefully.
- Run performance test: 3,000 sessions should process in under 10 minutes.
- Validate API endpoints return correct status codes and data formats.

### Task 15: Deployment to Vercel

- Push to GitHub → Vercel auto-deploys.
- Add environment variables via Vercel Dashboard:
  - `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
  - `RECOMPUTE_SECRET`
- Commit generated data (`/data/*.csv`) and initial `scores.json` to repo.
- Verify `/api/scores` endpoint works in production.
- Test that dashboard loads and displays tutors correctly.
- Confirm API routes and UI work in production environment.

---

## ✅ Completion Checklist

- [ ] Synthetic data generated locally (`/data/tutors.csv`, `/data/sessions.csv`) with 14 days of history
- [ ] Scoring algorithm implemented with defined formula (dropout × 40 + tech_issue × 30 + reschedule × 20 + rating_penalty × 10)
- [ ] AI explanation layer integrated into scoring script (score < 60 or bottom 20%, max 50)
- [ ] `/api/scores`, `/api/tutor/[id]`, `/api/recompute` live and tested
- [ ] Dashboard renders scores, color-coded chips, sparklines, and drawer details
- [ ] Filters working (subject dropdown, score threshold slider)
- [ ] Authentication on `/api/recompute` using `Authorization: Bearer` header
- [ ] `vercel.json` cron configuration added
- [ ] Deployed to Vercel with environment variables set
- [ ] Error handling and fallback templates implemented
- [ ] Cost tracking and display in footer
- [ ] Tests written and passing
- [ ] Demo video recorded
- [ ] README and documentation complete with cost analysis and 90-day roadmap
