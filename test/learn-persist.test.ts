import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLearnResumable, startLearn } from '../src/core/learn.ts'
import { clearLearnResume, loadLearnResume, saveLearnResume } from '../src/core/learn-persist.ts'
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

test('saveLearnResume / clearLearnResume round-trip when localStorage exists', () => {
  if (typeof localStorage === 'undefined') return
  const s = emptyState()
  const ts = '2026-06-01T00:00:00Z'
  if (!s.decks.length) s.decks.push({ id: 'd', name: 'd', createdAt: ts, updatedAt: ts })
  s.notes.push({ id: 'n', deckId: 'd', type: 'basic', fields: { front: 'q', back: 'A' }, tags: ['t'], createdAt: ts, updatedAt: ts })
  s.cards.push({ id: 'c', noteId: 'n', deckId: 'd', ord: 0, createdAt: ts, updatedAt: ts })
  s.notes.push({ id: 'n2', deckId: 'd', type: 'basic', fields: { front: 'q2', back: 'B' }, tags: ['t'], createdAt: ts, updatedAt: ts })
  s.cards.push({ id: 'c2', noteId: 'n2', deckId: 'd', ord: 0, createdAt: ts, updatedAt: ts })
  s.notes.push({ id: 'n3', deckId: 'd', type: 'basic', fields: { front: 'q3', back: 'C' }, tags: ['t'], createdAt: ts, updatedAt: ts })
  s.cards.push({ id: 'c3', noteId: 'n3', deckId: 'd', ord: 0, createdAt: ts, updatedAt: ts })

  let sess = startLearn(s, ['c'], {
    spacingGap: 0,
    interleave: false,
    pretest: false,
    adaptiveLadder: false,
    fsrsReviewRungs: false,
    familiarity: 'new',
    seed: 1,
  })
  const payload = {
    session: sess,
    savedAt: new Date().toISOString(),
    deckId: 'd',
    unitKeys: ['t'],
  }
  saveLearnResume(payload, 'manual')
  assert.ok(isLearnResumable(loadLearnResume('manual')))
  clearLearnResume('manual')
  assert.equal(loadLearnResume('manual'), null)
})

test('isLearnResumable false for completed sessions', () => {
  const s = emptyState()
  const sess = startLearn(s, [], { seed: 1 })
  assert.equal(isLearnResumable({ session: sess, savedAt: new Date().toISOString(), deckId: '', unitKeys: [] }), false)
})