import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_FRONT_IMAGE, resolveMediaUrl } from '../src/core/media.ts'
import { renderContent } from '../src/core/schedule.ts'
import {
  ensureImageDemoDeckFromCsv,
  EXPECTED_IMAGE_CARDS,
  imageDemoDeckNeedsReload,
  IMAGE_DEMO_DECK_NAME,
  imageDemoItems,
} from '../src/core/image-demo.ts'
import { getState, resetAll } from '../src/core/store.ts'
import type { Card, Note } from '../src/core/types.ts'

test('resolveMediaUrl: relative public paths and absolute URLs', () => {
  assert.equal(resolveMediaUrl('insignia/o4.svg'), '/insignia/o4.svg')
  assert.equal(resolveMediaUrl('/insignia/o4.svg'), '/insignia/o4.svg')
  assert.equal(resolveMediaUrl('https://cdn.example.com/x.png'), 'https://cdn.example.com/x.png')
  assert.equal(resolveMediaUrl(''), undefined)
})

test('renderContent includes questionImage from frontImage field', () => {
  const note: Note = {
    id: 'n1',
    deckId: 'd1',
    type: 'basic',
    fields: {
      front: 'What rank wears this collar device?',
      back: 'Lieutenant Commander (LCDR)',
      [FIELD_FRONT_IMAGE]: 'insignia/navy-officer-collar/o4-lcdr.png',
    },
    tags: ['navy-officer-rank'],
    createdAt: 'x',
    updatedAt: 'x',
  }
  const card: Card = { id: 'c1', noteId: 'n1', deckId: 'd1', ord: 0, createdAt: 'x', updatedAt: 'x' }
  const out = renderContent(note, card)
  assert.equal(out.questionImage, '/insignia/navy-officer-collar/o4-lcdr.png')
  assert.equal(out.answer, 'Lieutenant Commander (LCDR)')
})

test('ensureImageDemoDeckFromCsv imports PDF demo deck idempotently', () => {
  resetAll()
  const csvPath = join(process.cwd(), 'public', 'decks', 'ODS_Ranks_Demo_deck.csv')
  const csvText = readFileSync(csvPath, 'utf8')

  const first = ensureImageDemoDeckFromCsv(csvText)
  assert.equal(first.decksCreated, 1)
  assert.ok(first.cardsAdded >= EXPECTED_IMAGE_CARDS)
  assert.equal(first.imageCards, EXPECTED_IMAGE_CARDS)
  assert.equal(imageDemoDeckNeedsReload(getState()), false)

  const deck = getState().decks.find((d) => d.name === IMAGE_DEMO_DECK_NAME)
  assert.ok(deck)

  const second = ensureImageDemoDeckFromCsv(csvText)
  assert.equal(second.decksCreated, 0)
  assert.equal(second.cardsAdded, 0)
  assert.equal(second.added, 0)
  assert.equal(imageDemoItems(getState()).length, EXPECTED_IMAGE_CARDS)
})

test('ensureImageDemoDeckFromCsv force reload replaces stale SVG image paths', () => {
  resetAll()
  const csvPath = join(process.cwd(), 'public', 'decks', 'ODS_Ranks_Demo_deck.csv')
  const csvText = readFileSync(csvPath, 'utf8')
  ensureImageDemoDeckFromCsv(csvText)

  const deckId = getState().decks.find((d) => d.name === IMAGE_DEMO_DECK_NAME)!.id
  const notes = getState().notes.map((n) =>
    n.deckId === deckId && n.fields.frontImage
      ? { ...n, fields: { ...n.fields, frontImage: n.fields.frontImage.replace('.png', '.svg') } }
      : n,
  )
  // simulate persisted stale deck without going through store mutator
  ;(getState() as { notes: typeof notes }).notes = notes
  assert.equal(imageDemoDeckNeedsReload(getState()), true)

  const reloaded = ensureImageDemoDeckFromCsv(csvText, { force: true })
  assert.equal(reloaded.imageCards, EXPECTED_IMAGE_CARDS)
  assert.equal(imageDemoDeckNeedsReload(getState()), false)
  const paths = imageDemoItems(getState()).map((x) => x.note.fields.frontImage)
  assert.ok(paths.every((p) => p?.endsWith('.png')))
})