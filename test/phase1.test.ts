import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Rating } from 'ts-fsrs'
import { clozeIndices, renderCloze } from '../src/core/cloze.ts'
import { parseCsv, csvToCards, csvToNotes } from '../src/core/csv.ts'
import { dueQueue } from '../src/core/schedule.ts'
import { computeStats } from '../src/core/stats.ts'
import { previewIntervals, recomputeCard } from '../src/core/fsrs.ts'
import { createEmptyCard } from 'ts-fsrs'
import type { AppState, Card, Deck, Note, ReviewEvent } from '../src/core/types.ts'

function emptyState(): AppState {
  return { decks: [], notes: [], cards: [], events: [], tombstones: [], commitments: [], checkpoints: [], attempts: [], settings: { newPerDay: 20, desiredRetention: 0.9 }, learnHighlight: null }
}

let n = 0
const id = (p: string) => `${p}-${n++}`

function withBasic(state: AppState, deckName: string, front: string, back: string): Card {
  let deck = state.decks.find((d) => d.name === deckName)
  if (!deck) {
    deck = { id: id('deck'), name: deckName, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' } satisfies Deck
    state.decks.push(deck)
  }
  const note: Note = { id: id('note'), deckId: deck.id, type: 'basic', fields: { front, back }, tags: [], createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }
  const card: Card = { id: id('card'), noteId: note.id, deckId: deck.id, ord: 0, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' }
  state.notes.push(note)
  state.cards.push(card)
  return card
}

function ev(cardId: string, rating: number, iso: string): ReviewEvent {
  return { id: id('ev'), cardId, rating: rating as ReviewEvent['rating'], reviewedAt: iso, deviceId: 'test-device' }
}

test('cloze: indices and rendering', () => {
  const text = '{{c1::DNA}} is transcribed into {{c2::RNA::3 letters}}.'
  assert.deepEqual(clozeIndices(text), [1, 2])

  const c1 = renderCloze(text, 1)
  assert.equal(c1.question, '[...] is transcribed into RNA.')
  assert.equal(c1.answer, '[DNA] is transcribed into RNA.')

  const c2 = renderCloze(text, 2)
  assert.equal(c2.question, 'DNA is transcribed into [3 letters].') // hint shown
  assert.equal(c2.answer, 'DNA is transcribed into [RNA].')
})

test('csv: quoted fields, embedded commas, header detection', () => {
  const grid = parseCsv('front,back\n"Hello, world","a ""quoted"" answer"')
  assert.deepEqual(grid, [
    ['front', 'back'],
    ['Hello, world', 'a "quoted" answer'],
  ])

  const withHeader = csvToCards('front,back,deck\n"Capital of France?",Paris,Geography')
  assert.equal(withHeader.length, 1)
  assert.deepEqual(withHeader[0], { front: 'Capital of France?', back: 'Paris', deck: 'Geography', tags: [] })

  const positional = csvToCards('Capital of Japan?,Tokyo', 'Fallback')
  assert.deepEqual(positional[0], { front: 'Capital of Japan?', back: 'Tokyo', deck: 'Fallback', tags: [] })
})

test('csvToNotes: basic + cloze rows with a type column', () => {
  const csv = [
    'type,deck,front,back,text,tags',
    'basic,Nav,"Navy birthday?","13 October 1775",,facts',
    'cloze,Nav,,,"I am a United States {{c1::Sailor}}.",creed',
  ].join('\n')
  const notes = csvToNotes(csv)
  assert.equal(notes.length, 2)
  assert.deepEqual(notes[0], { type: 'basic', deck: 'Nav', front: 'Navy birthday?', back: '13 October 1775', text: '', tags: ['facts'] })
  assert.equal(notes[1].type, 'cloze')
  assert.equal(notes[1].text, 'I am a United States {{c1::Sailor}}.')
  assert.deepEqual(notes[1].tags, ['creed'])

  // still handles the old headerless front,back,deck format
  const legacy = csvToNotes('Capital of Japan?,Tokyo,Geo')
  assert.equal(legacy[0].type, 'basic')
  assert.equal(legacy[0].front, 'Capital of Japan?')
  assert.equal(legacy[0].deck, 'Geo')
})

test('schedule: new cards are limited by newPerDay; reviewed cards leave the queue', () => {
  const state = emptyState()
  state.settings.newPerDay = 1
  const a = withBasic(state, 'Geo', 'A?', 'a')
  withBasic(state, 'Geo', 'B?', 'b')

  const now = new Date('2026-06-10T09:00:00Z')
  const q1 = dueQueue(state, now)
  assert.equal(q1.length, 1, 'only 1 new card allowed today')
  assert.equal(q1[0].isNew, true)

  // Introduce + review card A today: allowance is now used up and A is not yet due.
  // With unlimited review support we still surface previously-seen cards for extra
  // practice so the review feature (and its modes) can be used any time.
  state.events.push(ev(a.id, Rating.Good, '2026-06-10T09:00:05Z'))
  const q2 = dueQueue(state, new Date('2026-06-10T09:00:10Z'))
  assert.ok(q2.length > 0, 'reviewed cards remain available for unlimited extra practice')
  const reviewedItem = q2.find((i) => i.card.id === a.id)
  assert.ok(reviewedItem && reviewedItem.isNew === false, 'the reviewed card is included as non-new extra practice')
})

test('stats: counts and true retention over mature reviews', () => {
  const state = emptyState()
  const a = withBasic(state, 'Geo', 'A?', 'a')
  state.events.push(ev(a.id, Rating.Good, '2026-06-10T09:00:00Z')) // introduction
  state.events.push(ev(a.id, Rating.Again, '2026-06-10T09:30:00Z')) // mature review, failed

  const s = computeStats(state, new Date('2026-06-10T10:00:00Z'))
  assert.equal(s.totalCards, 1)
  assert.equal(s.newCount, 0)
  assert.equal(s.reviewsToday, 2)
  assert.equal(s.trueRetention30d, 0) // one mature review, failed -> 0%
})

test('fsrs: preview returns all four ratings; replay is deterministic', () => {
  const card = createEmptyCard(new Date('2026-06-10T09:00:00Z'))
  const preview = previewIntervals(card, new Date('2026-06-10T09:00:00Z'))
  assert.deepEqual(Object.keys(preview).sort(), ['1', '2', '3', '4'])

  const events: ReviewEvent[] = [ev('c', Rating.Good, '2026-06-10T09:00:00Z'), ev('c', Rating.Good, '2026-06-13T09:00:00Z')]
  assert.equal(JSON.stringify(recomputeCard(events)), JSON.stringify(recomputeCard([...events].reverse())))
})
