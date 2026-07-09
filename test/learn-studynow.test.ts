import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildStudyNow, startLearnFromUnits } from '../src/core/learn.ts'
import { ensureImageDemoDeckFromCsv } from '../src/core/image-demo.ts'
import { getState, resetAll } from '../src/core/store.ts'
import type { AppState, Card, GradedAttempt, Note, ReviewEvent } from '../src/core/types.ts'

const CSV_PATH = join(dirname(fileURLToPath(import.meta.url)), '../public/decks/ODS_Ranks_Demo_deck.csv')

// Study now: one-click plan — fading memories first, then weak cards, then a
// few new ones, capped to the session size with slots reserved for new material.

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
function withCard(state: AppState): Card {
  const note: Note = {
    id: `n${n}`,
    deckId: 'd1',
    type: 'basic',
    fields: { front: `Q${n}?`, back: `A${n}` },
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

const NOW = new Date('2026-07-07T12:00:00Z')
let ids = 0

function reviewedDaysAgo(state: AppState, cardId: string, daysAgo: number): void {
  const e: ReviewEvent = {
    id: `e${ids++}`,
    cardId,
    rating: 3,
    reviewedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    deviceId: 'test',
  }
  state.events.push(e)
}

function attempted(state: AppState, cardId: string, correct: boolean, daysAgo = 1): void {
  const a: GradedAttempt = {
    id: `a${ids++}`,
    cardId,
    mode: 'typed',
    correct,
    answeredAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    source: 'review',
  }
  state.attempts.push(a)
}

test('buildStudyNow: fading → weak → new, in that unit order', () => {
  const state = emptyState()
  const lapsedOld = withCard(state) // reviewed 60d ago — weakest memory
  const lapsedNewer = withCard(state) // reviewed 20d ago
  const weak = withCard(state) // attempts only, 1/2 correct
  const strong = withCard(state) // reviewed minutes ago + solid attempts — excluded
  const fresh1 = withCard(state)
  const fresh2 = withCard(state)

  reviewedDaysAgo(state, lapsedOld.id, 60)
  reviewedDaysAgo(state, lapsedNewer.id, 20)
  attempted(state, weak.id, false)
  attempted(state, weak.id, true)
  reviewedDaysAgo(state, strong.id, 0)
  attempted(state, strong.id, true)
  attempted(state, strong.id, true)

  const plan = buildStudyNow(state, { maxCards: 15, at: NOW })
  assert.deepEqual(
    plan.units.map((u) => u.label),
    ['Refresh', 'Weak areas', 'New material'],
  )
  // Weakest memory first within Refresh.
  assert.deepEqual(plan.units[0].cardIds, [lapsedOld.id, lapsedNewer.id])
  assert.deepEqual(plan.units[1].cardIds, [weak.id])
  assert.deepEqual(new Set(plan.units[2].cardIds), new Set([fresh1.id, fresh2.id]))
  assert.equal(plan.total, 5)
  // The freshly-reviewed strong card is nowhere in the plan.
  assert.ok(!plan.units.some((u) => u.cardIds.includes(strong.id)))
})

test('buildStudyNow: cap respected, new-material slots reserved against a review backlog', () => {
  const state = emptyState()
  const lapsed: Card[] = []
  for (let i = 0; i < 20; i++) {
    const c = withCard(state)
    lapsed.push(c)
    reviewedDaysAgo(state, c.id, 30 + i)
  }
  for (let i = 0; i < 5; i++) withCard(state) // fresh

  const plan = buildStudyNow(state, { maxCards: 10, at: NOW })
  assert.equal(plan.total, 10)
  assert.equal(plan.due, 7) // 10 minus 3 reserved for new
  assert.equal(plan.fresh, 3)
  assert.equal(plan.weak, 0)
})

test('buildStudyNow: a card that is both due and weak appears only in Refresh', () => {
  const state = emptyState()
  const both = withCard(state)
  reviewedDaysAgo(state, both.id, 45)
  attempted(state, both.id, false)
  attempted(state, both.id, false)

  const plan = buildStudyNow(state, { maxCards: 10, at: NOW })
  assert.equal(plan.due, 1)
  assert.equal(plan.weak, 0)
  assert.equal(
    plan.units.flatMap((u) => u.cardIds).filter((id) => id === both.id).length,
    1,
  )
})

test('buildStudyNow: maxNew caps unseen cards', () => {
  const state = emptyState()
  for (let i = 0; i < 12; i++) withCard(state)
  const plan = buildStudyNow(state, { maxCards: 15, maxNew: 4, at: NOW })
  assert.equal(plan.fresh, 4)
  assert.equal(plan.total, 4)
})

test('buildStudyNow: empty collection → empty plan', () => {
  const plan = buildStudyNow(emptyState(), { at: NOW })
  assert.equal(plan.total, 0)
  assert.deepEqual(plan.units, [])
})

test('buildStudyNow: brand-new collection honors the session size, bounded by newPerDay', () => {
  const state = emptyState()
  for (let i = 0; i < 30; i++) withCard(state)

  // Size selector wins when under newPerDay…
  assert.equal(buildStudyNow(state, { maxCards: 15, at: NOW }).fresh, 15)
  // …and newPerDay bounds it above.
  assert.equal(buildStudyNow(state, { maxCards: 25, at: NOW }).fresh, 20)
})

test('buildStudyNow: prioritizes unseen collar-device image cards', () => {
  resetAll()
  ensureImageDemoDeckFromCsv(readFileSync(CSV_PATH, 'utf8'))
  const plan = buildStudyNow(getState(), { maxCards: 10, at: NOW })
  assert.equal(plan.images, 3)
  const imageUnit = plan.units.find((u) => u.key === 'study-images')
  assert.ok(imageUnit)
  assert.equal(imageUnit!.cardIds.length, 3)
})

test('study-now sessions skip unit synthesis (priority buckets are not topics)', () => {
  const state = emptyState()
  const lapsed = [withCard(state), withCard(state)]
  for (const c of lapsed) reviewedDaysAgo(state, c.id, 40)
  for (let i = 0; i < 3; i++) withCard(state)

  const plan = buildStudyNow(state, { maxCards: 10, at: NOW })
  assert.ok(plan.units.length >= 2)
  const session = startLearnFromUnits(state, plan.units, {
    tabMode: 'adaptive',
    familiarity: 'new',
    focus: 'study',
    seed: 1,
  })
  assert.ok(!session.phases.some((p) => p.kind === 'synthesis'))
  // Cumulative review phases remain — that's the spaced-repetition value.
  assert.ok(session.phases.some((p) => p.kind === 'review'))
})
