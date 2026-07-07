import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Rating } from 'ts-fsrs'
import { gradeChoice, gradeText, levenshtein, makeChoices, normalize, ratingFromResult } from '../src/core/grading.ts'
import type { AppState, Card, Note } from '../src/core/types.ts'

let k = 0
function emptyState(): AppState {
  return { decks: [], notes: [], cards: [], events: [], tombstones: [], commitments: [], checkpoints: [], attempts: [], settings: { newPerDay: 20, desiredRetention: 0.9 } }
}
function addBasic(state: AppState, deckId: string, front: string, back: string): { card: Card; note: Note } {
  const id = k++
  const ts = '2026-06-01T00:00:00Z'
  const note: Note = { id: `n${id}`, deckId, type: 'basic', fields: { front, back }, tags: [], createdAt: ts, updatedAt: ts }
  const card: Card = { id: `c${id}`, noteId: note.id, deckId, ord: 0, createdAt: ts, updatedAt: ts }
  state.notes.push(note)
  state.cards.push(card)
  return { note, card }
}

test('gradeText: exact, normalized, near-miss, wrong, empty', () => {
  assert.deepEqual(gradeText('Paris', 'paris'), { correct: true, near: false })
  assert.deepEqual(gradeText('Paris', '  Paris. '), { correct: true, near: false }) // case/space/punct normalized
  const near = gradeText('mitochondria', 'mitochondia') // 1 missing letter
  assert.equal(near.correct, true)
  assert.equal(near.near, true)
  assert.deepEqual(gradeText('Paris', 'London'), { correct: false, near: false })
  assert.deepEqual(gradeText('Paris', ''), { correct: false, near: false })
})

test('ratingFromResult maps exact→Good, near→Hard, wrong→Again', () => {
  assert.equal(ratingFromResult({ correct: true, near: false }), Rating.Good)
  assert.equal(ratingFromResult({ correct: true, near: true }), Rating.Hard)
  assert.equal(ratingFromResult({ correct: false, near: false }), Rating.Again)
})

test('gradeChoice is exact-option match (normalized)', () => {
  assert.equal(gradeChoice('Tokyo', 'tokyo').correct, true)
  assert.equal(gradeChoice('Tokyo', 'Kyoto').correct, false)
})

test('makeChoices includes the correct answer + distractors from other cards, deduped', () => {
  const state = emptyState()
  state.decks.push({ id: 'd1', name: 'Geo', createdAt: 'x', updatedAt: 'x' })
  const { card, note } = addBasic(state, 'd1', 'Capital of France?', 'Paris')
  addBasic(state, 'd1', 'Capital of Japan?', 'Tokyo')
  addBasic(state, 'd1', 'Capital of Italy?', 'Rome')
  addBasic(state, 'd1', 'Capital of Spain?', 'Madrid')

  const opts = makeChoices(state, card, note, 4)
  assert.ok(opts.includes('Paris'), 'correct answer present')
  assert.ok(opts.length >= 2 && opts.length <= 4)
  assert.equal(new Set(opts.map(normalize)).size, opts.length, 'no duplicate options')
  for (const o of opts) if (o !== 'Paris') assert.ok(['Tokyo', 'Rome', 'Madrid'].includes(o))
})

test('levenshtein distance', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3)
  assert.equal(levenshtein('abc', 'abc'), 0)
})
