import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerLearn,
  conceptKeyForCard,
  currentLearn,
  decayLearnSession,
  effectiveMasteryStreak,
  learnBlankCoverage,
  startLearn,
} from '../src/core/learn.ts'
import type { AppState, Card, Note } from '../src/core/types.ts'
import type { LearnSession as LS } from '../src/core/learn.ts'

// Per-concept in-session tuning: coverage bias scoped to the answered card's
// concept, and automatic drill-in for cards that keep failing.

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
    // Synthesis answers go through answerUnitSynthesis (UI-level); these tests
    // drive answerLearn only, so keep sessions to learn/review phases.
    settings: { newPerDay: 20, desiredRetention: 0.9, learnUnitSynthesis: false },
    learnHighlight: null,
  }
}

let n = 0
function withCard(state: AppState, front: string, back: string, tags: string[]): Card {
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

/** Answer the current card until the target card surfaces, then answer it. */
function answerCard(state: AppState, session: LS, cardId: string, passed: boolean): LS {
  let s = session
  for (let guard = 0; guard < 50; guard++) {
    const cur = currentLearn(s)
    if (!cur) throw new Error('session ended before target card')
    if (cur.cardId === cardId) return answerLearn(state, s, passed).session
    s = answerLearn(state, s, true).session
  }
  throw new Error('target card never surfaced')
}

test('conceptKeyForCard: first tag, deck fallback', () => {
  const state = emptyState()
  const tagged = withCard(state, 'q', 'a', ['alpha', 'beta'])
  const untagged = withCard(state, 'q2', 'a2', [])
  const notesById = new Map(state.notes.map((x) => [x.id, x]))
  assert.equal(conceptKeyForCard(tagged, notesById.get(tagged.noteId)), 'alpha')
  assert.equal(conceptKeyForCard(untagged, notesById.get(untagged.noteId)), 'deck:d1')
})

test('missing a card eases blank coverage for ITS concept, not others', () => {
  const state = emptyState()
  const alphaCards = [withCard(state, 'A1?', 'Apple', ['alpha']), withCard(state, 'A2?', 'Avocado', ['alpha'])]
  const betaCards = [withCard(state, 'B1?', 'Banana', ['beta']), withCard(state, 'B2?', 'Blueberry', ['beta'])]
  const ids = [...alphaCards, ...betaCards].map((c) => c.id)
  let session = startLearn(state, ids, { seed: 1, tabMode: 'adaptive', familiarity: 'some', spacingGap: 0 })

  // Miss an alpha card twice; pass a beta card twice.
  session = answerCard(state, session, alphaCards[0].id, false)
  session = answerCard(state, session, alphaCards[0].id, false)
  session = answerCard(state, session, betaCards[0].id, true)

  const ladder = ['mcq', 'blank', 'typed'] as const
  const covAlpha = learnBlankCoverage(session, 1, [...ladder], 0.6, alphaCards[1].id)
  const covBeta = learnBlankCoverage(session, 1, [...ladder], 0.6, betaCards[1].id)
  assert.ok(
    covAlpha < covBeta,
    `alpha (missed) should have sparser blanks than beta (passed): ${covAlpha} vs ${covBeta}`,
  )
  const biasAlpha = session.conceptCoverageBias?.['alpha']
  const biasBeta = session.conceptCoverageBias?.['beta']
  assert.ok(biasAlpha !== undefined && biasBeta !== undefined)
  assert.ok(biasAlpha! < biasBeta!)
})

test('untouched concepts fall back to the session-wide bias', () => {
  const state = emptyState()
  const alpha = withCard(state, 'A?', 'Apple', ['alpha'])
  const gamma = withCard(state, 'G?', 'Grape', ['gamma'])
  const session = startLearn(state, [alpha.id, gamma.id], { seed: 1, tabMode: 'adaptive', familiarity: 'some' })
  const ladder = ['mcq', 'blank', 'typed'] as const
  // No answers yet: both read the same (global) bias.
  assert.equal(
    learnBlankCoverage(session, 1, [...ladder], 0.6, alpha.id),
    learnBlankCoverage(session, 1, [...ladder], 0.6, gamma.id),
  )
})

test('a card that fails twice earns an automatic ×2 drill-in', () => {
  const state = emptyState()
  const cards = [
    withCard(state, 'Q1?', 'Apple', ['alpha']),
    withCard(state, 'Q2?', 'Banana', ['alpha']),
    withCard(state, 'Q3?', 'Cherry', ['alpha']),
    withCard(state, 'Q4?', 'Damson', ['alpha']),
  ]
  const target = cards[0]
  let session = startLearn(state, cards.map((c) => c.id), {
    seed: 1,
    tabMode: 'adaptive',
    familiarity: 'some',
    spacingGap: 0,
  })

  assert.equal(effectiveMasteryStreak(session, target.id), 1)
  session = answerCard(state, session, target.id, false)
  assert.equal(effectiveMasteryStreak(session, target.id), 1)
  session = answerCard(state, session, target.id, false)
  assert.equal(effectiveMasteryStreak(session, target.id), 2)

  // Mastery now requires two consecutive top-rung passes: climb to the top and
  // pass once — the card must come back instead of mastering.
  let mastered = false
  let sawPendingTopPass = false
  let s: LS = session
  for (let guard = 0; guard < 80 && !mastered; guard++) {
    const cur = currentLearn(s)
    if (!cur) break
    const isTarget = cur.cardId === target.id
    const atTop = isTarget && !cur.pretest && cur.rung === cur.ladder.length - 1
    if (atTop && cur.topPasses === 1) sawPendingTopPass = true
    const res = answerLearn(state, s, true)
    if (isTarget && res.mastery?.cardId === target.id) {
      assert.ok(sawPendingTopPass, 'target must pass the top rung twice before mastering')
      mastered = true
    }
    s = res.session
  }
  assert.ok(mastered, 'target eventually masters after proving the top rung twice')
})

test('mastery clears drill-in debt — cumulative review needs only one top pass', () => {
  const state = emptyState()
  const cards = [
    withCard(state, 'Q1?', 'Apple', ['alpha']),
    withCard(state, 'Q2?', 'Banana', ['alpha']),
    withCard(state, 'Q3?', 'Cherry', ['alpha']),
    withCard(state, 'Q4?', 'Damson', ['alpha']),
  ]
  const target = cards[0]
  let session = startLearn(state, cards.map((c) => c.id), {
    seed: 1,
    tabMode: 'adaptive',
    familiarity: 'some',
    spacingGap: 0,
  })
  session = answerCard(state, session, target.id, false)
  session = answerCard(state, session, target.id, false)
  assert.equal(effectiveMasteryStreak(session, target.id), 2)

  // Master the target (two top-rung passes since it earned drill-in).
  let s: LS = session
  for (let guard = 0; guard < 80; guard++) {
    const cur = currentLearn(s)
    if (!cur) break
    const res = answerLearn(state, s, true)
    s = res.session
    if (res.mastery?.cardId === target.id) break
  }
  assert.equal(s.fails?.[target.id], undefined, 'mastery should wipe the miss ledger')
  assert.equal(effectiveMasteryStreak(s, target.id), 1)
})

test('multi-day decay resets drill-in debt along with proof streaks', () => {
  const state = emptyState()
  const cards = [
    withCard(state, 'Q1?', 'Apple', ['alpha']),
    withCard(state, 'Q2?', 'Banana', ['alpha']),
    withCard(state, 'Q3?', 'Cherry', ['alpha']),
    withCard(state, 'Q4?', 'Damson', ['alpha']),
  ]
  const target = cards[0]
  let session = startLearn(state, cards.map((c) => c.id), {
    seed: 1,
    tabMode: 'adaptive',
    familiarity: 'some',
    spacingGap: 0,
  })
  session = answerCard(state, session, target.id, false)
  session = answerCard(state, session, target.id, false)
  assert.equal(effectiveMasteryStreak(session, target.id), 2)

  const decayed = decayLearnSession(session, '2026-07-04T00:00:00Z', new Date('2026-07-07T00:00:00Z'))
  assert.equal(decayed.fails, undefined)
  assert.equal(effectiveMasteryStreak(decayed, target.id), 1)
})

test('manual sessions keep fixed coverage regardless of concept bias', () => {
  const state = emptyState()
  const alpha = withCard(state, 'A?', 'Apple', ['alpha'])
  let session = startLearn(state, [alpha.id], { seed: 1, tabMode: 'manual', spacingGap: 0 })
  session = answerLearn(state, session, false).session
  const ladder = ['mcq', 'blank', 'typed'] as const
  assert.equal(learnBlankCoverage(session, 1, [...ladder], 0.6, alpha.id), 0.6)
})
