import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Rating } from 'ts-fsrs'
import {
  decayLearnSession,
  learnMasteryRating,
  mergeLearnHighlight,
  mergeLearnHighlightRemote,
  shouldGraduateLearnMastery,
  startLearn,
} from '../src/core/learn.ts'
import { prioritizeQueue } from '../src/core/schedule.ts'
import { recomputeCard } from '../src/core/fsrs.ts'
import {
  __setStateForTest,
  addLearnHighlight,
  getState,
  graduateLearnMastery,
  markLearnHighlightReviewed,
} from '../src/core/store.ts'
import type { AppState, Card, Deck, Note } from '../src/core/types.ts'

function emptyState(): AppState {
  return {
    decks: [],
    notes: [],
    cards: [],
    events: [],
    tombstones: [],
    commitments: [],
    checkpoints: [],
    attempts: [],
    settings: { newPerDay: 20, desiredRetention: 0.9, learnGraduateFsrs: true },
    learnHighlight: null,
  }
}

let n = 0
function withCard(state: AppState, front: string, back: string): Card {
  const deck: Deck = state.decks[0] ?? {
    id: `d${n}`,
    name: 'Test',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
  if (!state.decks.length) state.decks.push(deck)
  const note: Note = {
    id: `n${n}`,
    deckId: deck.id,
    type: 'basic',
    fields: { front, back },
    tags: [],
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
  const card: Card = {
    id: `c${n++}`,
    noteId: note.id,
    deckId: deck.id,
    ord: 0,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
  state.notes.push(note)
  state.cards.push(card)
  return card
}

test('learnMasteryRating: typed→Good, mcq→Hard', () => {
  assert.equal(learnMasteryRating('typed'), Rating.Good)
  assert.equal(learnMasteryRating('mcq'), Rating.Hard)
})

test('shouldGraduateLearnMastery: learn yes, review with prior events no', () => {
  const s = emptyState()
  const card = withCard(s, 'q', 'A')
  assert.equal(shouldGraduateLearnMastery(s, card.id, 'learn', 'typed'), true)
  s.events.push({
    id: 'e1',
    cardId: card.id,
    rating: Rating.Good,
    reviewedAt: '2026-06-01T00:00:00Z',
    deviceId: 'dev',
  })
  assert.equal(shouldGraduateLearnMastery(s, card.id, 'review', 'typed'), false)
  assert.equal(shouldGraduateLearnMastery(s, card.id, 'catchup', 'typed'), true)
})

test('shouldGraduateLearnMastery: self mode never graduates (self-rate records its own review)', () => {
  const s = emptyState()
  const card = withCard(s, 'q', 'A')
  assert.equal(shouldGraduateLearnMastery(s, card.id, 'learn', 'self'), false)
  assert.equal(shouldGraduateLearnMastery(s, card.id, 'catchup', 'self'), false)
})

test('graduateLearnMastery with self mode appends nothing (no double-log of one recall)', () => {
  const s = emptyState()
  const a = withCard(s, 'q', 'A')
  __setStateForTest(s)
  graduateLearnMastery(a.id, 'self', 'learn')
  assert.equal(getState().events.length, 0)
})

test('graduateLearnMastery appends a ReviewEvent in learn phase', () => {
  const s = emptyState()
  const a = withCard(s, 'q1', 'Alpha')
  withCard(s, 'q2', 'Bravo')
  withCard(s, 'q3', 'Charlie')
  __setStateForTest(s)
  graduateLearnMastery(a.id, 'typed', 'learn')
  const st = getState()
  assert.equal(st.events.length, 1)
  assert.equal(st.events[0].cardId, a.id)
  assert.equal(st.events[0].rating, Rating.Good)
  assert.equal(st.events[0].mode, 'typed')
  assert.ok(recomputeCard(st.events.filter((e) => e.cardId === a.id)).reps >= 1)
})

test('graduateLearnMastery skipped when learnGraduateFsrs is false', () => {
  const s = emptyState()
  s.settings.learnGraduateFsrs = false
  const a = withCard(s, 'q', 'A')
  __setStateForTest(s)
  graduateLearnMastery(a.id, 'typed', 'learn')
  assert.equal(getState().events.length, 0)
})

test('decayLearnSession drops rungs after whole days away', () => {
  const s = emptyState()
  withCard(s, 'q1', 'A')
  withCard(s, 'q2', 'B')
  withCard(s, 'q3', 'C')
  let sess = startLearn(s, s.cards.map((c) => c.id), {
    spacingGap: 0,
    interleave: false,
    pretest: false,
    adaptiveLadder: false,
    fsrsReviewRungs: false,
    familiarity: 'new',
    seed: 1,
  })
  const savedAt = '2026-06-01T12:00:00Z'
  const decayed = decayLearnSession(sess, savedAt, new Date('2026-06-03T12:00:00Z'))
  const item = decayed.queue[0]
  assert.ok(item)
  assert.equal(item.rung, 0)
  sess = { ...sess, queue: [{ cardId: item.cardId, rung: 2 }] }
  const decayed2 = decayLearnSession(sess, savedAt, new Date('2026-06-02T12:00:00Z'))
  assert.equal(decayed2.queue[0].rung, 1)
})

test('mergeLearnHighlightRemote expires stale highlights', () => {
  const old = { cardIds: ['a'], setAt: '2020-01-01T00:00:00Z' }
  const fresh = { cardIds: ['b'], setAt: new Date().toISOString() }
  assert.deepEqual(mergeLearnHighlightRemote(old, fresh)?.cardIds, ['b'])
  assert.equal(mergeLearnHighlightRemote(old, null), null)
})

test('mergeLearnHighlight dedupes and addLearnHighlight stores on state', () => {
  const merged = mergeLearnHighlight(null, ['a', 'b'])
  assert.deepEqual(merged?.cardIds, ['a', 'b'])
  const s = emptyState()
  __setStateForTest(s)
  addLearnHighlight(['c1', 'c2'])
  assert.deepEqual(getState().learnHighlight?.cardIds, ['c1', 'c2'])
  markLearnHighlightReviewed('c1')
  assert.deepEqual(getState().learnHighlight?.cardIds, ['c2'])
})

test('prioritizeQueue puts highlighted cards first', () => {
  const mk = (id: string) =>
    ({
      card: { id } as Card,
      note: {} as Note,
      deckName: 'd',
      question: 'q',
      answer: 'a',
      fsrs: recomputeCard([]),
      isNew: true,
    }) as const
  const q = [mk('a'), mk('b'), mk('c')]
  const ordered = prioritizeQueue([...q], ['c', 'a'])
  assert.deepEqual(ordered.map((i) => i.card.id), ['a', 'c', 'b'])
})