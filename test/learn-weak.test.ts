import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerLearn,
  buildPhases,
  currentLearn,
  startLearn,
  startLearnFromUnits,
  weakUnitCandidates,
} from '../src/core/learn.ts'
import type { AppState, Card, GradedAttempt, Note } from '../src/core/types.ts'

function emptyState(): AppState {
  return {
    decks: [{ id: 'd1', name: 'Test', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }],
    notes: [],
    cards: [],
    events: [],
    tombstones: [],
    commitments: [],
    checkpoints: [],
    attempts: [],
    settings: { newPerDay: 20, desiredRetention: 0.9 },
    learnHighlight: null,
  }
}

let n = 0
function withCard(state: AppState, front: string, back: string, tags: string[] = []): Card {
  const note: Note = {
    id: `n${n}`,
    deckId: 'd1',
    type: 'basic',
    fields: { front, back },
    tags,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
  const card: Card = {
    id: `c${n++}`,
    noteId: note.id,
    deckId: 'd1',
    ord: 0,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
  state.notes.push(note)
  state.cards.push(card)
  return card
}

let an = 0
function attempt(state: AppState, cardId: string, correct: boolean): void {
  const a: GradedAttempt = {
    id: `a${an++}`,
    cardId,
    mode: 'typed',
    correct,
    answeredAt: '2026-07-01T00:00:00Z',
    source: 'review',
  }
  state.attempts.push(a)
}

const times = (k: number, fn: () => void) => { for (let i = 0; i < k; i++) fn() }

test('weakUnitCandidates: weakest concept first; strong and low-data concepts excluded', () => {
  const s = emptyState()
  const a1 = withCard(s, 'a1?', 'Alpha One', ['alpha'])
  const a2 = withCard(s, 'a2?', 'Alpha Two', ['alpha'])
  withCard(s, 'a3?', 'Alpha Three', ['alpha']) // never attempted
  const b1 = withCard(s, 'b1?', 'Beta One', ['beta'])
  const g1 = withCard(s, 'g1?', 'Gamma One', ['gamma'])
  const d1 = withCard(s, 'd1?', 'Delta One', ['delta'])

  times(3, () => attempt(s, a1.id, false)) // alpha: weak
  attempt(s, a1.id, true)
  times(2, () => attempt(s, a2.id, true))
  times(4, () => attempt(s, b1.id, true)) // beta: 100% — not weak
  times(2, () => attempt(s, g1.id, false)) // gamma: only 2 attempts — below minAttempts
  times(4, () => attempt(s, d1.id, false)) // delta: 0% — weakest
  attempt(s, d1.id, true)

  const cands = weakUnitCandidates(s, s.cards.map((c) => c.id))
  assert.deepEqual(cands.map((c) => c.stat.label), ['delta', 'alpha'])
  assert.ok(cands[0].stat.accuracy < cands[1].stat.accuracy)
  assert.equal(cands[0].unit.cardIds.length, 1)
})

test('weakUnitCandidates: cards ordered weakest first (unattempted between missed and perfect), capped', () => {
  const s = emptyState()
  const a1 = withCard(s, 'a1?', 'Alpha One', ['alpha']) // 25%
  const a2 = withCard(s, 'a2?', 'Alpha Two', ['alpha']) // 100%
  const a3 = withCard(s, 'a3?', 'Alpha Three', ['alpha']) // unattempted
  times(3, () => attempt(s, a1.id, false))
  attempt(s, a1.id, true)
  times(2, () => attempt(s, a2.id, true))

  const [cand] = weakUnitCandidates(s, s.cards.map((c) => c.id))
  assert.deepEqual(cand.unit.cardIds, [a1.id, a3.id, a2.id])

  const [capped] = weakUnitCandidates(s, s.cards.map((c) => c.id), { maxCardsPerUnit: 2 })
  assert.deepEqual(capped.unit.cardIds, [a1.id, a3.id])
})

test('weakUnitCandidates: untagged cards roll up under their deck', () => {
  const s = emptyState()
  const u1 = withCard(s, 'u1?', 'Untagged One')
  times(3, () => attempt(s, u1.id, false))
  const cands = weakUnitCandidates(s, s.cards.map((c) => c.id))
  assert.equal(cands.length, 1)
  assert.equal(cands[0].stat.kind, 'deck')
  assert.deepEqual(cands[0].unit.cardIds, [u1.id])
})

const DRILL_OPTS = {
  spacingGap: 0,
  interleave: false,
  pretest: false,
  adaptiveLadder: false,
  fsrsReviewRungs: false,
  seed: 1,
} as const

test('masteryStreak 2: top rung must pass twice before mastery', () => {
  const s = emptyState()
  const card = withCard(s, 'Capital of France?', 'Paris') // ladder: blank → typed (no mcq without distractors)
  let sess = startLearn(s, [card.id], { ...DRILL_OPTS, masteryStreak: 2 })

  // climb to top
  assert.equal(currentLearn(sess)?.mode, 'blank')
  sess = answerLearn(s, sess, true).session
  assert.equal(currentLearn(sess)?.mode, 'typed')

  // first top-rung pass: NOT mastered — card comes back to prove it again
  let r = answerLearn(s, sess, true)
  sess = r.session
  assert.equal(r.mastery, null)
  assert.equal(sess.masteredCount, 0)
  const again = currentLearn(sess)
  assert.equal(again?.mode, 'typed')
  assert.equal(again?.topPasses, 1)
  assert.equal(again?.masteryStreak, 2)

  // second consecutive top-rung pass: mastered + graduated
  r = answerLearn(s, sess, true)
  sess = r.session
  assert.equal(r.mastery?.cardId, card.id)
  assert.equal(sess.masteredCount, 1)
  assert.deepEqual(sess.graduatedCardIds, [card.id])
  assert.equal(sess.done, true)
})

test('masteryStreak 2: a top-rung miss resets the streak', () => {
  const s = emptyState()
  const card = withCard(s, 'Capital of France?', 'Paris')
  let sess = startLearn(s, [card.id], { ...DRILL_OPTS, masteryStreak: 2 })

  sess = answerLearn(s, sess, true).session // blank pass → typed
  sess = answerLearn(s, sess, true).session // typed pass 1/2
  assert.equal(currentLearn(sess)?.topPasses, 1)

  sess = answerLearn(s, sess, false).session // miss → drop rung, streak resets
  assert.equal(currentLearn(sess)?.mode, 'blank')
  assert.equal(currentLearn(sess)?.topPasses, 0)

  sess = answerLearn(s, sess, true).session // climb back
  sess = answerLearn(s, sess, true).session // typed pass 1/2 again (not mastered)
  assert.equal(sess.masteredCount, 0)
  assert.equal(currentLearn(sess)?.topPasses, 1)
  const r = answerLearn(s, sess, true) // 2/2 → mastered
  assert.equal(r.session.masteredCount, 1)
})

test('default masteryStreak 1: single top-rung pass masters (unchanged behavior)', () => {
  const s = emptyState()
  const card = withCard(s, 'Capital of France?', 'Paris')
  let sess = startLearn(s, [card.id], { ...DRILL_OPTS })
  sess = answerLearn(s, sess, true).session
  const r = answerLearn(s, sess, true)
  assert.equal(r.mastery?.cardId, card.id)
  assert.equal(r.session.masteredCount, 1)
})

test('weak-focus session start: units flow through with focus + streak set', () => {
  const s = emptyState()
  const a1 = withCard(s, 'a1?', 'Alpha One', ['alpha'])
  times(3, () => attempt(s, a1.id, false))
  const cands = weakUnitCandidates(s, s.cards.map((c) => c.id))
  assert.equal(cands.length, 1)
})

test('weak drill: single learn phase, cards shuffled across topics', () => {
  const units = [
    { key: 'weak:tag:alpha', label: 'alpha', cardIds: ['a1', 'a2'] },
    { key: 'weak:tag:beta', label: 'beta', cardIds: ['b1', 'b2'] },
  ]
  assert.deepEqual(buildPhases(units, true, 'weak'), [{ kind: 'learn', unit: 0 }])

  const s = emptyState()
  const a1 = withCard(s, 'a1?', 'Alpha One', ['alpha'])
  const a2 = withCard(s, 'a2?', 'Alpha Two', ['alpha'])
  const b1 = withCard(s, 'b1?', 'Beta One', ['beta'])
  const b2 = withCard(s, 'b2?', 'Beta Two', ['beta'])
  times(3, () => attempt(s, a1.id, false))
  times(3, () => attempt(s, b1.id, false))

  const cands = weakUnitCandidates(s, s.cards.map((c) => c.id))
  const sess = startLearnFromUnits(s, cands.map((c) => c.unit), {
    tabMode: 'adaptive',
    familiarity: 'some',
    masteryStreak: 2,
    focus: 'weak',
    seed: 42,
    spacingGap: 0,
    interleave: false,
    pretest: false,
    adaptiveLadder: false,
    fsrsReviewRungs: false,
  })
  assert.equal(sess.focus, 'weak')
  assert.equal(sess.phases.length, 1)

  const order = sess.queue.map((item) => item.cardId)
  assert.equal(order.length, 4)
  assert.deepEqual([...order].sort(), [a1.id, a2.id, b1.id, b2.id].sort())
  // seed 42 should interleave — not all of one topic before the other
  const alpha = new Set([a1.id, a2.id])
  const beta = new Set([b1.id, b2.id])
  const hasAlpha = order.some((id) => alpha.has(id))
  const hasBeta = order.some((id) => beta.has(id))
  assert.ok(hasAlpha && hasBeta)
  const blockSorted = [...order].sort((x, y) => {
    const ax = alpha.has(x) ? 0 : 1
    const ay = alpha.has(y) ? 0 : 1
    return ax - ay || x.localeCompare(y)
  })
  assert.notDeepEqual(order, blockSorted, 'queue should be shuffled, not blocked by topic')
})
