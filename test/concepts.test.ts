import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeConcepts, weakCards } from '../src/core/concepts.ts'
import type { AppState, GradedAttempt } from '../src/core/types.ts'

let k = 0
function emptyState(): AppState {
  return { decks: [], notes: [], cards: [], events: [], tombstones: [], commitments: [], checkpoints: [], attempts: [], settings: { newPerDay: 20, desiredRetention: 0.9 } }
}
function addCard(state: AppState, deckId: string, tags: string[]): string {
  const id = k++
  const ts = '2026-06-01T00:00:00Z'
  state.notes.push({ id: `n${id}`, deckId, type: 'basic', fields: { front: 'q', back: 'a' }, tags, createdAt: ts, updatedAt: ts })
  state.cards.push({ id: `c${id}`, noteId: `n${id}`, deckId, ord: 0, createdAt: ts, updatedAt: ts })
  return `c${id}`
}
function attempt(cardId: string, correct: boolean): GradedAttempt {
  return { id: `a${k++}`, cardId, mode: 'typed', correct, answeredAt: '2026-06-01T00:00:00Z', source: 'review' }
}

test('computeConcepts ranks weakest first; untagged cards fall back to deck', () => {
  const state = emptyState()
  state.decks.push({ id: 'd1', name: 'Bio', createdAt: 'x', updatedAt: 'x' })
  const c1 = addCard(state, 'd1', ['glycolysis'])
  const c2 = addCard(state, 'd1', ['cranial-nerves'])
  const c3 = addCard(state, 'd1', []) // untagged -> deck "Bio"

  state.attempts.push(attempt(c1, true), attempt(c1, false), attempt(c1, false), attempt(c1, false)) // 25%
  state.attempts.push(attempt(c2, true), attempt(c2, true), attempt(c2, true), attempt(c2, false)) // 75%
  state.attempts.push(attempt(c3, true), attempt(c3, true)) // 100%, deck bucket

  const concepts = computeConcepts(state, { minAttempts: 1 })
  assert.equal(concepts[0].label, 'glycolysis')
  assert.equal(concepts[0].kind, 'tag')
  assert.ok(Math.abs(concepts[0].accuracy - 0.25) < 1e-9)

  const deckConcept = concepts.find((c) => c.kind === 'deck')
  assert.ok(deckConcept && deckConcept.label === 'Bio', 'untagged rolled up under deck')

  // sorted weakest -> strongest
  for (let i = 1; i < concepts.length; i++) assert.ok(concepts[i - 1].accuracy <= concepts[i].accuracy)
})

test('a multi-tag card contributes to every tag', () => {
  const state = emptyState()
  state.decks.push({ id: 'd1', name: 'X', createdAt: 'x', updatedAt: 'x' })
  const c = addCard(state, 'd1', ['a', 'b'])
  state.attempts.push(attempt(c, false))
  const concepts = computeConcepts(state, { minAttempts: 1 })
  assert.equal(concepts.find((x) => x.label === 'a')?.attempts, 1)
  assert.equal(concepts.find((x) => x.label === 'b')?.attempts, 1)
})

test('weakCards ranks lowest-accuracy cards first', () => {
  const state = emptyState()
  state.decks.push({ id: 'd1', name: 'X', createdAt: 'x', updatedAt: 'x' })
  const good = addCard(state, 'd1', [])
  const bad = addCard(state, 'd1', [])
  state.attempts.push(attempt(good, true), attempt(good, true))
  state.attempts.push(attempt(bad, false), attempt(bad, false))
  assert.equal(weakCards(state, { minAttempts: 1 })[0].cardId, bad)
})
