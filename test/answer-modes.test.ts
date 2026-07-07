import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerAppearsInQuestion,
  blankIsWorthwhile,
  isLabelOnlyAnswer,
  mcqIsWorthwhile,
  resolveGradedMode,
} from '../src/core/answer-modes.ts'
import { cardLadder } from '../src/core/learn.ts'
import { makeChoices } from '../src/core/grading.ts'
import type { AppState } from '../src/core/types.ts'

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
    settings: { newPerDay: 20, desiredRetention: 0.9 },
    learnHighlight: null,
  }
}

function addBasic(state: AppState, deckId: string, tag: string, front: string, back: string) {
  const id = `c${state.cards.length}`
  const ts = '2026-06-01T00:00:00Z'
  if (!state.decks.find((d) => d.id === deckId)) {
    state.decks.push({ id: deckId, name: deckId, createdAt: ts, updatedAt: ts })
  }
  const note = { id: `n${id}`, deckId, type: 'basic' as const, fields: { front, back }, tags: tag ? [tag] : [], createdAt: ts, updatedAt: ts }
  const card = { id, noteId: note.id, deckId, ord: 0, createdAt: ts, updatedAt: ts }
  state.notes.push(note)
  state.cards.push(card)
  return { card, note }
}

test('isLabelOnlyAnswer detects article/section labels', () => {
  assert.equal(isLabelOnlyAnswer('Article 4'), true)
  assert.equal(isLabelOnlyAnswer('Art. 4'), true)
  assert.equal(isLabelOnlyAnswer('Members must respect one another at all times.'), false)
})

test('answerAppearsInQuestion catches leaks', () => {
  assert.equal(answerAppearsInQuestion('Summarize Article 4', 'Article 4'), true)
  assert.equal(answerAppearsInQuestion('What is prohibited harassment?', 'No member shall harass another.'), false)
})

test('blankIsWorthwhile rejects labels but allows real short answers', () => {
  assert.equal(blankIsWorthwhile('Article 4'), false)
  assert.equal(blankIsWorthwhile('Alpha'), true)
  assert.equal(blankIsWorthwhile('Respect all members and avoid harassment.'), true)
})

test('mcqIsWorthwhile rejects trivial article-label cards', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'd', 'coc', 'What is Article 4?', 'Article 4')
  addBasic(s, 'd', 'coc', 'What is Article 1?', 'Article 1')
  addBasic(s, 'd', 'coc', 'What is Article 2?', 'Article 2')
  assert.equal(mcqIsWorthwhile(s, card, note, 'What is Article 4?', 'Article 4'), false)
})

test('cardLadder skips mcq and blank for label-only article backs', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'd', 'coc', 'What is Article 4?', 'Article 4')
  addBasic(s, 'd', 'coc', 'What is Article 1?', 'Article 1')
  addBasic(s, 'd', 'coc', 'What is Article 2?', 'Article 2')
  addBasic(s, 'd', 'coc', 'What is Article 3?', 'Article 3')
  assert.deepEqual(cardLadder(s, card, note), ['typed'])
})

test('resolveGradedMode downgrades trivial MCQ and blank to typed', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'd', 'coc', 'What is Article 4?', 'Article 4')
  addBasic(s, 'd', 'coc', 'What is Article 1?', 'Article 1')
  addBasic(s, 'd', 'coc', 'What is Article 2?', 'Article 2')

  const mcq = resolveGradedMode(s, card, note, 'mcq')
  assert.equal(mcq.mode, 'typed')
  assert.equal(mcq.requested, 'mcq')
  assert.ok(mcq.fallbackReason)

  const blank = resolveGradedMode(s, card, note, 'blank')
  assert.equal(blank.mode, 'typed')
  assert.equal(blank.requested, 'blank')
  assert.ok(blank.fallbackReason)

  const typed = resolveGradedMode(s, card, note, 'typed')
  assert.deepEqual(typed, { mode: 'typed', requested: 'typed' })
})

test('resolveGradedMode keeps MCQ for shaped facts with distractors', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'd', 'history', 'When was the Navy established?', '13 October 1775')
  addBasic(s, 'd', 'history', 'When was the Marine Corps established?', '10 November 1775')
  addBasic(s, 'd', 'history', 'When was the Army established?', '14 June 1775')
  addBasic(s, 'd', 'history', 'When was the Air Force established?', '18 September 1947')

  const resolved = resolveGradedMode(s, card, note, 'mcq')
  assert.equal(resolved.mode, 'mcq')
  assert.equal(resolved.requested, 'mcq')
  assert.equal(resolved.fallbackReason, undefined)
})

test('resolveGradedMode keeps blank for substantive answers', () => {
  const s = emptyState()
  const { card, note } = addBasic(
    s,
    'd',
    'coc',
    'Article 4 — Conduct',
    'Each member shall treat others with dignity and refrain from harassment.',
  )
  const resolved = resolveGradedMode(s, card, note, 'blank')
  assert.equal(resolved.mode, 'blank')
  assert.equal(resolved.fallbackReason, undefined)
})

test('makeChoices excludes label distractors when correct is substantive', () => {
  const s = emptyState()
  const long =
    'Each member shall treat others with dignity and refrain from harassment in any form.'
  const { card, note } = addBasic(s, 'd', 'coc', 'Article 4 — Conduct', long)
  addBasic(s, 'd', 'coc', 'Article 1', 'Article 1')
  addBasic(s, 'd', 'coc', 'Article 2', 'Article 2')
  addBasic(s, 'd', 'coc', 'Article 3', 'Members shall attend all meetings.')
  const opts = makeChoices(s, card, note, 4)
  assert.ok(opts.includes(long))
  assert.ok(!opts.some((o) => /^article\s*\d+$/i.test(o.trim())))
})