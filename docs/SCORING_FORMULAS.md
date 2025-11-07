# Scoring Formula Versions

This document tracks the evolution of the TutorSense scoring formula. The scoring
script can switch between versions by setting the `SCORE_FORMULA_VERSION`
environment variable (default: `v2`).

## v1.0 (Baseline)

Used prior to the Phase 4 update. The formula focused on core reliability KPIs.

```
score = 100
  - (dropout_rate * 40)
  - (tech_issue_rate * 30)
  - (reschedule_rate * 20)
  - ((5 - avg_rating) * 10)
```

Key traits:

- Only considers aggregate dropout/tech/reschedule rates and the overall session
  rating.
- No special handling for first-session outcomes or tutor-initiated behaviours.
- Adequate for early MVP, but misses leading indicators for churn.

## v2.0 (Current Default)

Introduced in Phase 4 to incorporate richer signals gathered in Phases 2–3.

```
score = 100
  - (dropout_rate * 30)
  - (first_session_dropout_rate * (first_session_count > 0 ? 35 : 20))
  - (tech_issue_rate * 18)
  - (reschedule_rate * 12)
  - (tutor_initiated_reschedule_rate * 20)
  - (no_show_rate * 28)
  - ((5 - avg_rating) * 12)
  - (max(0, 4.5 - first_session_avg_rating) * 8)
  - (sessions_count < 5 ? 4 : sessions_count < 10 ? 2 : 0)
```

Highlights:

- Separates tutor-driven reschedules from the general reschedule rate.
- Adds explicit penalties for first-session churn and no-show behaviour.
- Rewards strong early-session ratings by reducing penalty when
  `first_session_avg_rating ≥ 4.5`.
- Applies a small penalty for low recent session volume to reflect data scarcity.

## Switching Versions

```
SCORE_FORMULA_VERSION=v1 npm run score
```

If the environment variable is omitted or set to an unknown value, the scoring
script defaults to `v2`.
