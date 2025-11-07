# TutorSense — Quick Reference Guide

**Quick lookup for key specifications during implementation**

---

## 📊 Scoring Formula

```javascript
const score = Math.max(
  0,
  Math.min(
    100,
    100 -
      (dropout_rate * 40 +
        tech_issue_rate * 30 +
        reschedule_rate * 20 +
        (5 - avg_rating) * 10)
  )
);
```

---

## 📋 CSV Schemas

### tutors.csv

```
tutor_id,name,subject,hire_date
T001,John Doe,Math,2024-01-15
```

### sessions.csv

```
session_id,tutor_id,date,duration_minutes,rating,status,has_tech_issue
S001,T001,2025-10-23,60,4,completed,false
```

**Status values:** `completed`, `dropout`, `rescheduled`

---

## 🎯 At-Risk Criteria

Generate AI explanations for tutors who meet:

- Score < 60 **OR** bottom 20% of all tutors
- **Maximum:** 50 explanations per batch (cost control)

---

## 🎨 Color Coding

| Score Range | Color     | Meaning         |
| ----------- | --------- | --------------- |
| > 80        | 🟢 Green  | Performing well |
| 60-80       | 🟡 Yellow | Needs attention |
| < 60        | 🔴 Red    | At-risk         |

---

## 🔌 API Endpoints

### GET /api/scores

Returns merged scores + explanations

```typescript
{
  generated_at: "2025-11-06T10:00:00Z",
  tutors: [{
    tutor_id: string,
    name: string,
    subject: string,
    score: number,
    trend_7d: number[],
    kpis: {
      avg_rating: number,
      dropout_rate: number,
      tech_issue_rate: number,
      reschedule_rate: number,
      sessions_count: number
    },
    explanation?: {
      why: string,
      suggested_action: string
    }
  }]
}
```

### GET /api/tutor/[id]

Returns 14-day time-series for single tutor

### POST /api/recompute

**Auth:** `Authorization: Bearer ${RECOMPUTE_SECRET}`

```typescript
{
  success: true,
  processed: number,
  duration_ms: number,
  explanations_generated: number,
  top_at_risk: Array<{tutor_id, name, score}>
}
```

---

## 📦 Dependencies

```bash
pnpm add openai@^4.0.0 papaparse zod
pnpm add -D typescript @types/papaparse @types/node tsx
```

---

## ⚙️ Environment Variables

```bash
OPENAI_API_KEY=sk-...
# OR
OPENROUTER_API_KEY=sk-...

RECOMPUTE_SECRET=your-secret-here
```

---

## 📁 File Structure

```
/data/
  tutors.csv
  sessions.csv
/scripts/
  generate_synthetic_data.ts  # Creates CSVs
  score_tutors.ts              # Scoring + AI explanations
/app/api/
  scores/route.ts
  tutor/[id]/route.ts
  recompute/route.ts
/components/
  AtRiskTable.tsx
  TutorDrawer.tsx
  Sparkline.tsx
/public/
  scores.json
  explanations.json
vercel.json                    # Cron config
```

---

## 🕐 Vercel Cron

**vercel.json:**

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

Runs daily at 02:00 UTC

---

## 📈 Data Generation

### Requirements:

- **Tutors:** 200
- **Sessions:** ~3,000 total
- **Time Period:** 14 days (for 7-day trends)
- **Distributions:**
  - Ratings: Mostly 4-5, some 3, few 1-2
  - Status: 80% completed, 10% dropout, 10% rescheduled
  - Tech Issues: 5-15% of sessions

---

## 💰 Cost Estimates

**Formula:**

```
cost = (input_tokens × $0.01/1K) + (output_tokens × $0.03/1K)
```

**Typical:**

- ~500 tokens per explanation
- 50 explanations = ~$0.50-$1.00/day

---

## 🧪 Testing Checklist

- [ ] Scoring formula with known inputs
- [ ] Score clamping [0, 100]
- [ ] Edge cases (no sessions, missing ratings)
- [ ] Schema validation (Zod)
- [ ] CSV parsing errors
- [ ] Performance: 3,000 sessions < 10 min
- [ ] API status codes

---

## 🎛️ UI Components

### Filter Defaults:

- Subject: "All"
- Score threshold: 60

### Header:

- Logo/title
- Last-updated timestamp
- Date picker (UI-only)
- Refresh button

### Footer:

- "Est. Daily Cost: $X.XX (based on N explanations)"

---

## 🚨 Error Handling

| Error                | Behavior                          |
| -------------------- | --------------------------------- |
| OpenAI API fails     | Use fallback templates            |
| Scoring script fails | Keep old scores.json, log error   |
| Frontend API down    | Show "Unable to load" + timestamp |

---

## 📝 Fallback Template Example

```typescript
if (!openaiAvailable) {
  explanation = {
    why: `Low score (${score}) due to: ${
      dropout_rate > 0.15 ? "high dropouts, " : ""
    }${tech_issue_rate > 0.15 ? "tech issues, " : ""}${
      avg_rating < 3.5 ? "low ratings" : ""
    }`,
    suggested_action: "Review recent sessions and provide targeted coaching",
  };
}
```

---

## 🚀 Deployment Steps

1. Push to GitHub
2. Connect to Vercel
3. Add env vars in Vercel Dashboard
4. Commit `/data/*.csv` and initial `scores.json`
5. Deploy main branch
6. Verify APIs work
7. Check cron logs after 02:00 UTC

---

## 📊 Performance Targets

- **Scoring:** < 10 min for 3,000 sessions
- **API Response:** < 500ms for `/api/scores`
- **Dashboard Load:** < 2s initial render

---

## 🔍 Debug Commands

```bash
# Generate data
npm run generate

# Run scoring locally
npm run score

# Start dev server
npm run dev

# Test API
curl http://localhost:3000/api/scores

# Test recompute
curl -X POST http://localhost:3000/api/recompute \
  -H "Authorization: Bearer your-secret"
```

---

**Last Updated:** November 6, 2025
