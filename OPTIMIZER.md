# Phase 3 — per-user FSRS weight optimization

The scheduler ships with FSRS-6 default weights (trained on 700M+ Anki reviews).
Phase 3 lets each user fit the 21 weights to **their own** review history, so
intervals match how they personally forget. Open the **Tune** tab and click
optimize.

> This is a lightweight, transparent optimizer that reuses ts-fsrs's validated
> memory model. Production should use the battle-tested Rust optimizer
> (`open-spaced-repetition/fsrs-rs`, or its WASM build `fsrs-browser`); this
> stands in for it the way the local sync server stands in for PowerSync.

## How it works

1. **Forward pass (reused, not reinvented).** For each card's review sequence we
   replay ts-fsrs's own memory model — `init_stability` / `init_difficulty` to
   seed state, `forgetting_curve` to predict recall before each review, and
   `next_state` to evolve (stability, difficulty). The state is clamped to FSRS's
   valid ranges (ts-fsrs validates but doesn't clamp).
2. **Objective.** Binary cross-entropy (log-loss) between predicted recall and the
   actual outcome (pass = anything but *Again*), averaged over every 2nd-or-later
   review.
3. **Fit.** Adam on numerical gradients over the 21 weights, weights clamped each
   step with ts-fsrs's `clipParameters`.
4. **Early stopping + honesty.** Sequences are split 60/20/20 into
   train / validation / test. We keep the weights with the best **validation**
   loss, initialized to the defaults — so the optimizer can never return weights
   that are worse than default on validation, and we report the improvement on the
   untouched **test** split. The app only adopts the new weights if they actually
   beat default on held-out data.

## Why event-sourcing makes this clean

Re-optimizing changes a pure function, nothing else. The review log is the source
of truth; `recomputeCard()` derives each card's schedule from it. So new weights
take effect by simply recomputing — **no data migration, no rescheduling job**.
`configureScheduler(weights)` swaps the active weights and every due date updates
on the next render.

## Verification

`test/optimizer.test.ts` generates a synthetic learner whose memory follows FSRS
with non-default "true" weights (perturbed stability + decay), sampling each
review's pass/fail from the true forgetting curve. The optimizer recovers a fit
that **beats the default weights on held-out data** (and returns null below the
20-review minimum). Verified live in-browser: on a slow-forgetting synthetic
history the Tune tab reported **held-out log-loss 0.916 → 0.663 (−28%)** and
applied the 21 personalized weights.

## Files

```
src/core/optimizer.ts   buildSequences, evaluateLoss, optimizeWeights (Adam + early stop)
src/core/fsrs.ts        configureScheduler() / getActiveWeights() — active weights
src/core/store.ts       setOptimizedWeights() / resetWeights() (+ apply on load)
src/app/components/Optimize.tsx   the Tune tab
test/optimizer.test.ts  synthetic-data correctness
```

## Limitations (out of scope here)

- **Lightweight optimizer** — numerical gradients + a small Adam loop, not the
  full Rust trainer. Good enough to personalize; production should swap in
  `fsrs-rs`/`fsrs-browser`.
- **Weights are per-device** — not synced (Phase 2 syncs the review log, not
  settings). A second device re-optimizes from the same synced history.
- **Min 20 reviews** to run; FSRS recommends 1,000+ for stable weights. Small-
  sample results are provisional and the optimizer keeps defaults if there's no
  generalizing gain.
