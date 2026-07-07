import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerLearn,
  answerUnitSynthesis,
  buildUnits,
  currentLearn,
  startLearnFromUnits,
  tickLearnQueue,
} from '../src/core/learn.ts'
import { buildUnitSynthesis, gradeUnitSynthesis } from '../src/core/unit-synthesis.ts'
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

function addCard(state: AppState, deckId: string, tag: string, front: string, back: string): string {
  const ts = '2026-06-01T00:00:00Z'
  if (!state.decks.find((d) => d.id === deckId)) {
    state.decks.push({ id: deckId, name: deckId, createdAt: ts, updatedAt: ts })
  }
  const id = `c${state.cards.length}`
  const note = { id: `n${id}`, deckId, type: 'basic' as const, fields: { front, back }, tags: tag ? [tag] : [], createdAt: ts, updatedAt: ts }
  const card = { id, noteId: note.id, deckId, ord: 0, createdAt: ts, updatedAt: ts }
  state.notes.push(note)
  state.cards.push(card)
  return id
}

const opts = {
  spacingGap: 0,
  interleave: false,
  pretest: false,
  adaptiveLadder: false,
  fsrsReviewRungs: false,
  tabMode: 'manual' as const,
  seed: 1,
}

test('buildUnitSynthesis returns one part per card for multi-card units', () => {
  const s = emptyState()
  addCard(s, 'd', 'code', 'Part 1', 'Respect all members')
  addCard(s, 'd', 'code', 'Part 2', 'No harassment')
  const units = buildUnits(s, s.cards.map((c) => c.id))
  const parts = buildUnitSynthesis(s, units[0])
  assert.equal(parts?.length, 2)
  assert.equal(parts![0].label, 'Part 1')
  assert.equal(parts![1].text, 'No harassment')
})

test('failed synthesis queues remediation then returns to full review', () => {
  const s = emptyState()
  const a = addCard(s, 'd', 'code', 'Part 1', 'Alpha')
  const b = addCard(s, 'd', 'code', 'Part 2', 'Bravo')
  addCard(s, 'd', 'code', 'Part 3', 'Charlie')
  const units = buildUnits(s, s.cards.map((c) => c.id))
  let sess = startLearnFromUnits(s, units, opts)

  while (!currentLearn(sess)?.unitSynthesis) {
    sess = answerLearn(s, sess, true).session
    sess = tickLearnQueue(sess)
    assert.ok(!sess.done)
  }

  sess = answerUnitSynthesis(s, sess, [
    { cardId: a, passed: true },
    { cardId: b, passed: false },
    { cardId: s.cards[2].id, passed: true },
  ])
  assert.ok(sess.synthesisRemediate)
  assert.equal(sess.queue.length, 1)
  assert.equal(sess.queue[0].cardId, b)

  sess = answerLearn(s, sess, true).session
  sess = tickLearnQueue(sess)
  assert.equal(sess.synthesisRemediate, undefined)
  assert.ok(currentLearn(sess)?.unitSynthesis)
})

test('gradeUnitSynthesis marks near-miss typed answers as passed', () => {
  const parts = [{ cardId: 'c1', label: 'L', text: 'Alpha', style: 'typed' as const }]
  const results = gradeUnitSynthesis(parts, { c1: 'Alpha' })
  assert.equal(results[0].passed, true)
})