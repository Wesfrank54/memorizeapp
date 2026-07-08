import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adaptiveStartRung,
  cardKnowledge,
  cardSeen,
  currentLearn,
  knowledgeStartRung,
  startLearn,
} from '../src/core/learn.ts'
import type { AnswerMode, AppState, Card, GradedAttempt, Note, ReviewEvent } from '../src/core/types.ts'

// Per-card data-driven starts: a card's own recent track record + FSRS state
// decides its starting rung; self-reported familiarity only covers unseen cards.

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
function withCard(state: AppState, front: string, back: string): Card {
  const note: Note = {
    id: `n${n}`,
    deckId: 'd1',
    type: 'basic',
    fields: { front, back },
    tags: ['topic'],
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
function attempt(state: AppState, cardId: string, correct: boolean, daysAgo: number, at: Date, mode: AnswerMode = 'typed'): void {
  const a: GradedAttempt = {
    id: `a${an++}`,
    cardId,
    mode,
    correct,
    answeredAt: new Date(at.getTime() - daysAgo * 86_400_000).toISOString(),
    source: 'review',
  }
  state.attempts.push(a)
}

function selfReview(state: AppState, cardId: string, daysAgo: number, at: Date): void {
  const e: ReviewEvent = {
    id: `e${an++}`,
    cardId,
    rating: 3,
    reviewedAt: new Date(at.getTime() - daysAgo * 86_400_000).toISOString(),
    deviceId: 'test',
  }
  state.events.push(e)
}

const NOW = new Date('2026-07-07T12:00:00Z')
const LADDER: AnswerMode[] = ['mcq', 'blank', 'typed']

test('cardKnowledge: unseen card has no data; recent answers outweigh old ones', () => {
  const state = emptyState()
  const fresh = withCard(state, 'Q1?', 'A1')
  const recentGood = withCard(state, 'Q2?', 'A2')
  const oldGood = withCard(state, 'Q3?', 'A3')

  // Same shape of history — 2 wrong then 2 right — but one card's successes are
  // recent while the other's are two months stale.
  attempt(state, recentGood.id, false, 60, NOW)
  attempt(state, recentGood.id, false, 55, NOW)
  attempt(state, recentGood.id, true, 2, NOW)
  attempt(state, recentGood.id, true, 1, NOW)
  attempt(state, oldGood.id, true, 60, NOW)
  attempt(state, oldGood.id, true, 55, NOW)
  attempt(state, oldGood.id, false, 2, NOW)
  attempt(state, oldGood.id, false, 1, NOW)

  assert.equal(cardKnowledge(state, fresh.id, NOW).seen, false)
  const kRecent = cardKnowledge(state, recentGood.id, NOW)
  const kOld = cardKnowledge(state, oldGood.id, NOW)
  assert.ok(kRecent.accuracy > 0.8, `recent successes should dominate (got ${kRecent.accuracy})`)
  assert.ok(kOld.accuracy < 0.2, `recent failures should dominate (got ${kOld.accuracy})`)
})

test('knowledgeStartRung: strong → top, middling → blank, weak → bottom, unseen → null', () => {
  const base = { seen: true, evidence: 3, retrievability: null }
  assert.equal(knowledgeStartRung({ ...base, accuracy: 0.95 }, LADDER), 2)
  assert.equal(knowledgeStartRung({ ...base, accuracy: 0.7 }, LADDER), 1)
  assert.equal(knowledgeStartRung({ ...base, accuracy: 0.3 }, LADDER), 0)
  assert.equal(knowledgeStartRung({ seen: false, evidence: 0, accuracy: 0, retrievability: null }, LADDER), null)
})

test('cardSeen counts review events (self-rated) as seen, not just graded attempts', () => {
  const state = emptyState()
  const selfRated = withCard(state, 'Q?', 'A')
  const fresh = withCard(state, 'Q2?', 'A2')
  selfReview(state, selfRated.id, 3, NOW)
  assert.equal(cardSeen(state, selfRated.id), true)
  assert.equal(cardSeen(state, fresh.id), false)
})

test('adaptive session: proven card starts at top rung even when familiarity says new', () => {
  const state = emptyState()
  const proven = withCard(state, 'What is the capital of France?', 'Paris')
  const fresh = withCard(state, 'What is the capital of Peru?', 'Lima')
  attempt(state, proven.id, true, 3, new Date(), 'typed')
  attempt(state, proven.id, true, 1, new Date(), 'typed')

  const session = startLearn(state, [proven.id, fresh.id], { seed: 1, tabMode: 'adaptive' })
  const withFam = { ...session, familiarity: 'new' as const }
  const phase = withFam.phases[0]

  const provenLadder = withFam.ladders[proven.id]
  const freshLadder = withFam.ladders[fresh.id]
  assert.equal(adaptiveStartRung(state, proven.id, provenLadder, phase, withFam), provenLadder.length - 1)
  // Unseen card falls back to the familiarity answer ('new' → easiest rung).
  assert.equal(adaptiveStartRung(state, fresh.id, freshLadder, phase, withFam), 0)
})

test('unseen adaptive card gets an MCQ pretest; a self-rated card does not', () => {
  const state = emptyState()
  withCard(state, 'What is the capital of Peru?', 'Lima')
  withCard(state, 'What is the capital of Brazil?', 'Brasilia')
  const selfRated = withCard(state, 'What is the capital of Chile?', 'Santiago')
  const fresh = withCard(state, 'What is the capital of Kenya?', 'Nairobi')
  selfReview(state, selfRated.id, 2, new Date())

  const session = startLearn(state, [fresh.id, selfRated.id], {
    seed: 1,
    tabMode: 'adaptive',
    familiarity: 'new',
  })
  const items = new Map(session.queue.map((i) => [i.cardId, i]))
  assert.equal(items.get(fresh.id)?.pretest, true)
  assert.equal(items.get(selfRated.id)?.pretest ?? false, false)
  const freshCur = currentLearn({ ...session, queue: session.queue.filter((i) => i.cardId === fresh.id) })
  assert.equal(freshCur?.mode, 'mcq')
})
