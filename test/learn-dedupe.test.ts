import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerLearn,
  cardLadder,
  currentLearn,
  passageKey,
  passageSourceText,
  startLearn,
  tickLearnQueue,
} from '../src/core/learn.ts'
import { buildUnitSynthesis } from '../src/core/unit-synthesis.ts'
import type { AppState, Card, Note } from '../src/core/types.ts'

// Passage-twin dedupe: a multi-deletion cloze note expands to N sibling cards,
// and a "Recite …" basic card can carry the identical answer text. All of them
// route to the same full-text reconstruction exercise — a session should run it
// once and credit every twin, not N+1 times.

const CLOZE_TEXT =
  'The mission of the Navy is to {{c1::recruit}}, {{c2::train}}, {{c3::equip}}, and {{c4::organize}} to deliver combat ready Naval forces.'
const FULL_TEXT =
  'The mission of the Navy is to recruit, train, equip, and organize to deliver combat ready Naval forces.'

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
function addBasic(state: AppState, front: string, back: string, tags: string[] = ['mission']): Card {
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

function addCloze(state: AppState, text: string, deletions: number, tags: string[] = ['mission']): Card[] {
  const note: Note = {
    id: `n${n}`,
    deckId: 'd1',
    type: 'cloze',
    fields: { text },
    tags,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  }
  state.notes.push(note)
  const cards: Card[] = []
  for (let ord = 0; ord < deletions; ord++) {
    const card: Card = {
      id: `c${n}-${ord}`,
      noteId: note.id,
      deckId: 'd1',
      ord,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    }
    state.cards.push(card)
    cards.push(card)
  }
  n++
  return cards
}

test('passageSourceText: cloze siblings and recite twins share one key', () => {
  const state = emptyState()
  const siblings = addCloze(state, CLOZE_TEXT, 4)
  const recite = addBasic(state, 'Recite the Mission of the Navy.', FULL_TEXT)
  const notesById = new Map(state.notes.map((note) => [note.id, note]))
  const keys = new Set(
    [...siblings, recite].map((c) => passageKey(passageSourceText(notesById.get(c.noteId)!, c))),
  )
  assert.equal(keys.size, 1)
})

test('startLearn collapses passage twins to one item, preferring the non-cloze rep', () => {
  const state = emptyState()
  const siblings = addCloze(state, CLOZE_TEXT, 4)
  const recite = addBasic(state, 'Recite the Mission of the Navy.', FULL_TEXT)
  const ids = [...siblings.map((c) => c.id), recite.id] // recite last: exercises the rep-promotion path
  const session = startLearn(state, ids, { seed: 1 })

  const remaining = session.units.flatMap((u) => u.cardIds)
  assert.deepEqual(remaining, [recite.id])
  assert.equal(session.totalToMaster, 1)
  assert.deepEqual(new Set(session.passagePeers?.[recite.id]), new Set(siblings.map((c) => c.id)))

  const cur = currentLearn(session)
  assert.equal(cur?.cardId, recite.id)
  const notesById = new Map(state.notes.map((note) => [note.id, note]))
  const ladder = cardLadder(state, state.cards.find((c) => c.id === recite.id)!, notesById.get(recite.noteId)!)
  assert.ok(ladder.includes('passage'))
  assert.ok(cur?.mode === 'mcq' || cur?.mode === 'blank' || cur?.mode === 'passage')
})

test('mastering the rep graduates every collapsed twin', () => {
  const state = emptyState()
  const siblings = addCloze(state, CLOZE_TEXT, 4)
  const recite = addBasic(state, 'Recite the Mission of the Navy.', FULL_TEXT)
  const ids = [recite.id, ...siblings.map((c) => c.id)]
  let session = startLearn(state, ids, { seed: 1 })

  let mastery: ReturnType<typeof answerLearn>['mastery'] = null
  for (let i = 0; i < 12 && !session.done; i++) {
    const result = answerLearn(state, session, true)
    mastery = result.mastery
    session = tickLearnQueue(result.session)
    if (mastery) break
  }
  assert.ok(mastery)
  assert.equal(mastery.cardId, recite.id)
  const next = session
  assert.deepEqual(new Set(mastery?.peerCardIds), new Set(siblings.map((c) => c.id)))
  assert.deepEqual(new Set(next.graduatedCardIds), new Set(ids))
  assert.equal(next.masteredCount, 1)
  assert.equal(next.done, true) // 1 collapsed card, 1 unit → no synthesis, no review
})

test('distinct passages do not collapse', () => {
  const state = emptyState()
  const a = addCloze(state, CLOZE_TEXT, 2)
  const b = addCloze(
    state,
    'The Sailors Creed begins {{c1::I am a United States Sailor}} and continues {{c2::with honor courage and commitment}} always.',
    2,
  )
  const session = startLearn(state, [...a, ...b].map((c) => c.id), { seed: 1 })
  const remaining = session.units.flatMap((u) => u.cardIds)
  assert.equal(remaining.length, 2)
  assert.deepEqual(new Set(remaining), new Set([a[0].id, b[0].id]))
})

test('buildUnitSynthesis dedupes identical passage parts (uncollapsed legacy units)', () => {
  const state = emptyState()
  const siblings = addCloze(state, CLOZE_TEXT, 4)
  const recite = addBasic(state, 'Recite the Mission of the Navy.', FULL_TEXT)
  const other = addBasic(
    state,
    'Recite the first General Order.',
    'To take charge of this post and all government property in view at all times.',
  )
  const unit = {
    key: 'mission',
    label: 'mission',
    cardIds: [...siblings.map((c) => c.id), recite.id, other.id],
  }
  const parts = buildUnitSynthesis(state, unit)
  assert.ok(parts)
  assert.equal(parts!.length, 2)
  const twin = parts!.find((p) => p.text === FULL_TEXT)
  assert.ok(twin)
  assert.equal(twin!.label, 'Recite the Mission of the Navy.') // non-cloze label preferred
  assert.equal(twin!.style, 'passage')
})
