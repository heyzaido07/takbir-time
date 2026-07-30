# Crowd-Sourced Jamat Timings — Algorithm Design

**Status:** proposal · 2026-04-26

## Problem

Mosques don't publish APIs. Their jamat times change seasonally, during Ramadan, with imam preferences, and after community consultation. A single source of truth (one user maintaining each mosque) doesn't scale to 700,000+ mosques worldwide. Yet *anyone* in the congregation can be wrong — daydreams, typos, stale knowledge, or even bad intent. We need a system that:

1. **Lets anyone contribute** without gatekeeping that scares off casual users
2. **Settles on the correct time** even when initial submissions disagree
3. **Reacts quickly** when many users report a real change (Ramadan starts, new imam shifts Maghrib by 5 min)
4. **Resists manipulation** by single bad actors or coordinated trolling
5. **Recognises domain authority** — the local imam knows better than a tourist
6. **Survives churn** — when the original contributor goes inactive, the system shouldn't freeze

## Existing primitives

The current schema already supports most of this:

- `TimingSubmission` — one row per user contribution (per prayer set)
- `Vote` (polymorphic) — already wired to upvote / downvote / report any submission
- `PrayerSchedule` — the "current truth" displayed to viewers (one active per mosque)
- `User.reputationPoints` — accrues on submissions and approvals
- `User.verifiedContributor` — manual flag (admin-set)

Today's flow: submission → admin reviews → schedule created. Only one human in the loop. Doesn't scale.

## Proposed algorithm — weighted consensus per prayer

For each `(mosque, prayer)` pair, treat the active jamat time as the **weighted-mode** of recent submissions. Recompute on every new submission AND on a daily cron.

### The score function

For a single submission `s` proposing time `t` for prayer `p` at mosque `m`:

```
score(s) =
    voteScore(s)              # base support
  × recencyWeight(s)          # newer matters more
  × reputationBoost(s)        # known contributors weigh more
  × keeperBoost(s, m, p)      # the time keeper's word is worth a few extra votes
```

where:

```
voteScore(s)        = 1 + max(0, upvotes(s) - downvotes(s))

recencyWeight(s)    = exp(-ageDays(s) / 14)
                      # half-life of 14 days
                      # day-old submission weighs ~95%
                      # 30-day-old submission weighs ~24%
                      # 90-day-old submission weighs ~1%

reputationBoost(s)  = (verifiedContributor ? 2.0 : 1.0)
                    × (1 + log10(1 + reputationPoints / 100))
                      # rep 0  → 1.0
                      # rep 100 → 1.30
                      # rep 1k  → 2.04
                      # rep 10k → 3.00
                      # capped softly by log

keeperBoost(s, m, p) = (s.submittedBy == m.timeKeeper ? 3.0 : 1.0)
```

### Picking the consensus

```
function computeConsensus(mosqueId, prayer):
    submissions = TimingSubmissions
        where mosqueId == mosqueId
        and timings[prayer] is not null
        and createdAt > now - 60 days
        and status != 'rejected'

    buckets = groupBy(submissions, s => s.timings[prayer])  # exact HH:mm

    for each bucket:
        bucket.weighted = sum(score(s) for s in bucket)
        bucket.contributors = count(distinct s.submittedBy for s in bucket)

    sort buckets by weighted descending

    top    = buckets[0]
    second = buckets[1] (or {weighted: 0})

    confidence = top.weighted / (top.weighted + second.weighted)

    return {
        time: top.time,
        confidence: confidence,
        contributors: top.contributors,
        supportCount: count(submissions in top bucket)
    }
```

### Promotion to the active schedule

A new consensus replaces the active `PrayerSchedule` only if **at least one** of:

- The active schedule's time **differs** from the new consensus, AND `confidence > 0.65`, AND `top.contributors >= 3`
- The active schedule is older than 90 days (refresh stale data)
- A "burst" condition: ≥4 new submissions in the last 48 hours all agreeing with `top.time`

**Never** silently override a schedule whose `verificationStatus = 'verified'` if `confidence < 0.80`. Verified means a human signed off. The bar to overrule is high.

### Why this works

| Property | Mechanism |
|---|---|
| **Resists single bad actor** | One troll's vote-of-1 is dwarfed by a bucket of 5 honest contributors (5–15× weighted) |
| **Resists vote stuffing** | A new account has rep 0 → 1× boost. No verified flag → no 2× boost. Sock-puppet swarms move slowly. |
| **Reacts to seasonal changes** | Burst rule: 4 fresh submissions in 48h flip the time, even if old data has more total weight |
| **Honours local authority** | Time keeper's submission counts as 3× (and rep further multiplies) — equivalent to ~6 random users |
| **Decays old data** | 14-day half-life means schedules drift toward freshness without explicit invalidation |
| **Recovers from inactive contributors** | Old data fades; new contributors' scores compound rapidly via votes |

### Examples

**Scenario 1: First contributor.** Only one submission for Fajr. Bucket count = 1. `confidence = 1.0` (no second bucket). Promoted as `verificationStatus = 'pending'`. Hero card works for the submitter immediately.

**Scenario 2: Seasonal change at Ramadan.** Old verified schedule says Fajr 04:50. Three new submissions come in saying 04:30 (Sehri start), all within 48 hours, all from rep-0 users. Burst rule triggers: even though the verified schedule has more cumulative weight, fresh agreement of 3+ contributors flips it. New status: `pending`, banner: "Time updated — pending verification."

**Scenario 3: Troll storm.** A coordinated group submits 20 new "Fajr 03:00" submissions in 1 hour. Each = score 1 × recency 1 × rep 1 × no keeper boost = 1.0 each. Total ≈ 20. Existing verified schedule (1 submission, 12 upvotes, keeper-submitted) = 13 × ~1 × 2 × 3 = 78. Verified bucket dominates; troll storm needs `confidence > 0.80` to flip. They can't reach it.

**Scenario 4: Imam updates Maghrib.** Time keeper (verified contributor, 5000 rep) submits new Maghrib time. Score = 1 × 1 × (2 × 2.7) × 3 ≈ 16. Even alone, this dwarfs a bucket of 5 random users (5 × 1 × 1 × 1 × 1 ≈ 5). Flips immediately.

## Time keeper role

A mosque can have one **time keeper** — typically the first verified contributor, or transferred manually.

- `Mosque.timeKeeperId UUID` (new column, nullable, references users)
- Automatic appointment: first user whose submission has been `verified` becomes the keeper
- Auto-transfer: if keeper has no activity (login OR submission OR review) for 90 days, role passes to most-active contributor of the past 30 days
- Keeper's submissions get the `keeperBoost = 3.0`
- Keeper has a UI for **reviewing suggestions** (see below)

## Suggest-update flow

When a non-keeper user disagrees with the current schedule:

1. They tap "Suggest a different time" in the drawer (next to the current time).
2. New `TimingSubmission` is created with extra fields:
   - `suggestionFor: <currentScheduleId>` — links it to the schedule it disagrees with
   - `suggestedTimings: {prayer: time, ...}` — only the changed prayers
3. The mosque's time keeper gets a `Notification`:
   > "Aamir Khan suggests Fajr 04:30 (you have it as 04:50). 2 others agree so far."
4. Keeper has three options:
   - **Accept**: Keeper's own submission gets created with the suggested timings, advances the consensus immediately (their `keeperBoost` makes it dominant).
   - **Decline with note**: Suggester's submission stays as a `TimingSubmission` (counts in voting), but keeper's note is shown next to it. Suggester gets a notification with the explanation.
   - **Ignore**: After 7 days with no keeper action, the suggestion is auto-merged into the consensus algorithm. If 3+ users agree by then, the consensus naturally flips and the keeper is notified.

This balances:
- Keeper authority (they can act decisively)
- Community input (ignored suggestions still flow into the algorithm)
- Failure mode (inactive keeper doesn't block updates indefinitely)

## Implementation phases

### Phase 1 — Read-side consensus (1 day)

- Add `consensusScore`, `contributorCount`, `lastConsensusAt` to `PrayerSchedule`
- Implement `computeConsensus(mosqueId, prayer)` as a pure function
- New endpoint `GET /api/mosques/:id/consensus` returning per-prayer consensus
- UI shows "X of Y users confirm Fajr 04:50" badge under each time

### Phase 2 — Write-side promotion (1 day)

- Modify `POST /api/submissions` to recompute consensus for affected prayers
- If consensus crosses promotion thresholds → update `PrayerSchedule.timings`
- Existing schedule kept in `PrayerSchedule` history (versioned via `validUntil`)

### Phase 3 — Time keeper + suggestions (2 days)

- Add `Mosque.timeKeeperId`
- Migration to backfill from oldest verified submission per mosque
- Suggest-update endpoint + drawer UI button
- Keeper notification + accept/decline UI

### Phase 4 — Reactivity + maintenance (1 day)

- Daily cron job: recompute consensus for mosques with new submissions
- Auto-transfer keeper role for 90-day inactive keepers
- Burst-detection job: flag rapid changes for human review

## Trade-offs and unknowns

- **Cold start**: A mosque with one submission and no votes has confidence 1.0 by definition, but really we have ~zero confidence. Display "1 submission, unverified" to manage user expectations.
- **Half-life tuning**: 14 days is a guess. Real prayer times change weekly to monthly. Could expose this as a per-mosque parameter if mosques behave differently (e.g., a tourist mosque vs. neighbourhood mosque).
- **Time-zone correctness**: Prayer times are local to the mosque, not the submitter. Already handled by storing as HH:mm strings in the mosque's local time. No bug, just worth flagging.
- **"Same time" matching**: Currently buckets by exact HH:mm. Should be tolerant of ±2 minutes (e.g., 17:30 and 17:32 are the "same" jamat). Add a clustering step before bucketing.
- **Spam vs. correctness**: A low-rep user might be the only one who knows the new Ramadan time. The burst condition handles this, but only if 3+ such users coordinate.

## What this changes about the current app

- `POST /api/submissions` becomes "submit + recompute + maybe-promote" instead of "create row + wait for admin"
- The "manual admin approval" pathway still exists for explicit verification
- The hero card shows the consensus time AND the confidence ("12 contributors agree on Fajr 04:50")
- Drawer shows alternate buckets when confidence is below 0.6 — "Some users say 04:30 (3 agree)"
- Submission UI gets a "your submission helped" toast: "Faisal Mosque now shows your Fajr time. 12 contributors agree."

## Decision required

Before building Phase 1, confirm:

1. The 14-day half-life feels right (or pick another)
2. Promotion thresholds (`confidence > 0.65`, `contributors >= 3`) feel right
3. Time keeper auto-appointment from oldest verified submission feels right (alternative: manual application from contributors)
4. Suggest-update UI lives in the drawer (alternative: separate "this time looks wrong" affordance on the hero card)

I'll wait on a "go" before starting Phase 1 implementation.
