import { clipParameters, default_relearning_steps, default_w, fsrs, generatorParameters } from 'ts-fsrs'
import type { Grade } from 'ts-fsrs'
import type { ReviewEvent } from './types.ts'

// Per-user FSRS weight optimization.
//
// We fit the 21 FSRS-6 weights to the user's own review history by minimizing
// binary cross-entropy (log-loss) between predicted recall and actual outcomes.
// The forward pass reuses ts-fsrs's *validated* memory model (init_stability,
// forgetting_curve, next_state) — we only add the optimization loop on top, so
// the objective matches what the scheduler actually uses to pick intervals.
//
// This is a lightweight, transparent optimizer. Production should use the
// battle-tested Rust optimizer (open-spaced-repetition/fsrs-rs, or its WASM
// build fsrs-browser); this stands in for it the way the local sync server
// stands in for PowerSync.

/** Minimum number of *predictions* (2nd+ reviews of a card) before optimizing. */
export const MIN_PREDICTIONS = 20

const NUM_RELEARNING = default_relearning_steps.length

/** A card's review history reduced to what the loss needs: grades + gaps in days. */
export interface ReviewSeq {
  grades: number[]
  /** Days since the previous review. elapsedDays[0] is unused (first review). */
  elapsedDays: number[]
}

export interface OptimizeResult {
  weights: number[]
  /** Number of predictions (reviews after each card's first) used. */
  predictions: number
  /** Log-loss on the training split: default weights -> optimized weights. */
  lossBefore: number
  lossAfter: number
  /** Log-loss on the held-out split, for an honest generalization estimate. */
  testLossDefault: number
  testLossOptimized: number
  iterations: number
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function clampW(w: number[]): number[] {
  return clipParameters([...w], NUM_RELEARNING)
}

function makeAlgo(weights: number[]) {
  return fsrs(generatorParameters({ enable_fuzz: false, w: clampW(weights) }))
}

/** Build per-card sequences, dropping cards with fewer than two reviews. */
export function buildSequences(events: ReviewEvent[]): ReviewSeq[] {
  const byCard = new Map<string, ReviewEvent[]>()
  for (const e of events) {
    const list = byCard.get(e.cardId)
    if (list) list.push(e)
    else byCard.set(e.cardId, [e])
  }
  const seqs: ReviewSeq[] = []
  for (const evs of byCard.values()) {
    if (evs.length < 2) continue
    const sorted = [...evs].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) || (a.id < b.id ? -1 : 1))
    const grades = sorted.map((e) => e.rating)
    const elapsedDays = sorted.map((e, i) =>
      i === 0 ? 0 : (Date.parse(e.reviewedAt) - Date.parse(sorted[i - 1].reviewedAt)) / 86_400_000,
    )
    seqs.push({ grades, elapsedDays })
  }
  return seqs
}

function countPredictions(seqs: ReviewSeq[]): number {
  return seqs.reduce((acc, s) => acc + (s.grades.length - 1), 0)
}

/** Keep the memory state in FSRS's valid ranges (ts-fsrs validates but doesn't clamp). */
function clampState(s: { stability: number; difficulty: number }): { stability: number; difficulty: number } {
  return { stability: clamp(s.stability, 0.001, 36500), difficulty: clamp(s.difficulty, 1, 10) }
}

/** Mean binary cross-entropy of predicted recall vs. actual pass/fail for `weights`. */
export function evaluateLoss(weights: number[], seqs: ReviewSeq[]): number {
  const algo = makeAlgo(weights)
  let sum = 0
  let n = 0
  for (const seq of seqs) {
    const g0 = seq.grades[0] as Grade
    let state = clampState({ stability: algo.init_stability(g0), difficulty: algo.init_difficulty(g0) })
    for (let i = 1; i < seq.grades.length; i++) {
      const g = seq.grades[i]
      const elapsed = seq.elapsedDays[i]
      const r = clamp(algo.forgetting_curve(elapsed, state.stability), 1e-6, 1 - 1e-6)
      const y = g > 1 ? 1 : 0 // pass = anything but "Again"
      sum += -(y * Math.log(r) + (1 - y) * Math.log(1 - r))
      n++
      state = clampState(algo.next_state(state, elapsed, g, r))
    }
  }
  return n === 0 ? 0 : sum / n
}

/** Deterministic 60/20/20 split by index (no RNG, so results are reproducible). */
function split3(seqs: ReviewSeq[]): { train: ReviewSeq[]; val: ReviewSeq[]; test: ReviewSeq[] } {
  const train: ReviewSeq[] = []
  const val: ReviewSeq[] = []
  const test: ReviewSeq[] = []
  seqs.forEach((s, i) => {
    const m = i % 5
    if (m < 3) train.push(s)
    else if (m === 3) val.push(s)
    else test.push(s)
  })
  return { train: train.length ? train : seqs, val: val.length ? val : seqs, test: test.length ? test : seqs }
}

/**
 * Fit FSRS weights to the user's reviews. Returns null without enough history.
 *
 * Adam on numerical gradients over the training split, with **early stopping on
 * a validation split**: we keep the weights that generalize best, initialized to
 * the defaults — so the optimizer never returns weights worse than default on
 * validation (it can't make your scheduling worse), and `testLoss*` is an honest
 * estimate measured on a third, untouched split.
 */
export function optimizeWeights(events: ReviewEvent[], opts?: { steps?: number; lr?: number }): OptimizeResult | null {
  const all = buildSequences(events)
  const predictions = countPredictions(all)
  if (predictions < MIN_PREDICTIONS) return null

  const { train, val, test } = split3(all)
  const steps = opts?.steps ?? 80
  const lr = opts?.lr ?? 0.1
  const h = 1e-3
  const [b1, b2, eps] = [0.9, 0.999, 1e-8]

  const def = clampW([...default_w])
  let w = [...def]
  const m = new Array(w.length).fill(0)
  const v = new Array(w.length).fill(0)

  let best = [...def]
  let bestVal = evaluateLoss(def, val)
  const lossBefore = evaluateLoss(def, train)

  for (let t = 1; t <= steps; t++) {
    const base = evaluateLoss(w, train)
    const grad = w.map((wi, i) => {
      const probe = [...w]
      probe[i] = wi + h
      return (evaluateLoss(probe, train) - base) / h
    })
    for (let i = 0; i < w.length; i++) {
      m[i] = b1 * m[i] + (1 - b1) * grad[i]
      v[i] = b2 * v[i] + (1 - b2) * grad[i] * grad[i]
      const mHat = m[i] / (1 - Math.pow(b1, t))
      const vHat = v[i] / (1 - Math.pow(b2, t))
      w[i] = w[i] - (lr * mHat) / (Math.sqrt(vHat) + eps)
    }
    w = clampW(w)
    const valLoss = evaluateLoss(w, val)
    if (valLoss < bestVal) {
      bestVal = valLoss
      best = [...w]
    }
  }

  return {
    weights: best,
    predictions,
    lossBefore,
    lossAfter: evaluateLoss(best, train),
    testLossDefault: evaluateLoss(def, test),
    testLossOptimized: evaluateLoss(best, test),
    iterations: steps,
  }
}
