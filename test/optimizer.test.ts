import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipParameters, default_relearning_steps, default_w, fsrs, generatorParameters } from 'ts-fsrs'
import { buildSequences, evaluateLoss, optimizeWeights } from '../src/core/optimizer.ts'
import type { ReviewEvent } from '../src/core/types.ts'

// Deterministic PRNG so the synthetic dataset (and the test) is reproducible.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Simulate a learner whose memory follows FSRS with *non-default* "true" weights.
 * Each review's pass/fail is sampled from the true forgetting curve, so default
 * weights mis-predict and a good optimizer should recover a better fit.
 */
// Perturb stability weights (initial S: w0-w3, recall-S growth: w8-w10) and the
// decay weight (w20, which reshapes the whole forgetting curve) so the learner
// forgets noticeably differently from FSRS defaults — without touching the
// difficulty math (w4-w7), which ts-fsrs validates strictly.
const PERTURB_IDX = new Set([0, 1, 2, 3, 8, 9, 10, 20])

function clampState(s: { stability: number; difficulty: number }): { stability: number; difficulty: number } {
  return { stability: Math.min(36500, Math.max(0.001, s.stability)), difficulty: Math.min(10, Math.max(1, s.difficulty)) }
}

function syntheticEvents(): ReviewEvent[] {
  const trueW = clipParameters(
    default_w.map((w, i) => (PERTURB_IDX.has(i) ? w * 1.5 : w)),
    default_relearning_steps.length,
  )
  const truth = fsrs(generatorParameters({ enable_fuzz: false, w: trueW }))
  const rng = mulberry32(42)
  const events: ReviewEvent[] = []
  const start = Date.parse('2026-01-01T00:00:00Z')

  for (let c = 0; c < 250; c++) {
    const cardId = `card-${c}`
    let state = clampState({ stability: truth.init_stability(3), difficulty: truth.init_difficulty(3) })
    let prev = start + c * 3_600_000
    events.push({ id: `ev-${c}-0`, cardId, rating: 3, reviewedAt: new Date(prev).toISOString(), deviceId: 'synth-device' })

    for (let r = 1; r < 7; r++) {
      // Review across a wide range of retrievabilities so pass/fail outcomes
      // actually constrain the forgetting curve (real signal to fit).
      const elapsed = Math.max(0.1, state.stability * (0.3 + 2.2 * rng()))
      const next = prev + elapsed * 86_400_000
      const pRecall = truth.forgetting_curve(elapsed, state.stability)
      const recalled = rng() < pRecall
      const grade = recalled ? (rng() < 0.2 ? 4 : 3) : 1
      events.push({ id: `ev-${c}-${r}`, cardId, rating: grade, reviewedAt: new Date(next).toISOString(), deviceId: 'synth-device' })
      state = clampState(truth.next_state(state, elapsed, grade, pRecall))
      prev = next
    }
  }
  return events
}

test('buildSequences drops single-review cards and orders by time', () => {
  const events: ReviewEvent[] = [
    { id: 'a', cardId: 'c1', rating: 3, reviewedAt: '2026-01-02T00:00:00Z', deviceId: 'test' },
    { id: 'b', cardId: 'c1', rating: 3, reviewedAt: '2026-01-01T00:00:00Z', deviceId: 'test' },
    { id: 'c', cardId: 'lonely', rating: 3, reviewedAt: '2026-01-01T00:00:00Z', deviceId: 'test' },
  ]
  const seqs = buildSequences(events)
  assert.equal(seqs.length, 1) // single-review card excluded
  assert.equal(seqs[0].grades.length, 2)
  assert.ok(seqs[0].elapsedDays[1] > 0) // ordered ascending -> positive gap
})

test('evaluateLoss is deterministic and finite', () => {
  const events = syntheticEvents()
  const seqs = buildSequences(events)
  const l1 = evaluateLoss([...default_w], seqs)
  const l2 = evaluateLoss([...default_w], seqs)
  assert.equal(l1, l2)
  assert.ok(Number.isFinite(l1) && l1 > 0)
})

test('optimizer beats default on held-out data', () => {
  const events = syntheticEvents()
  const res = optimizeWeights(events, { steps: 80 })
  assert.ok(res, 'enough data to optimize')

  assert.ok(
    res.testLossOptimized < res.testLossDefault,
    `held-out should improve: ${res.testLossDefault.toFixed(4)} -> ${res.testLossOptimized.toFixed(4)}`,
  )
  assert.equal(res.weights.length, default_w.length)
})

test('optimizeWeights returns null without enough history', () => {
  const events: ReviewEvent[] = [
    { id: 'a', cardId: 'c1', rating: 3, reviewedAt: '2026-01-01T00:00:00Z', deviceId: 'test' },
    { id: 'b', cardId: 'c1', rating: 3, reviewedAt: '2026-01-05T00:00:00Z', deviceId: 'test' },
  ]
  assert.equal(optimizeWeights(events), null)
})
