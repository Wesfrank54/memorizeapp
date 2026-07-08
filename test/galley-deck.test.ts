import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  galleyDeckCardCount,
  GALLEY_DECK_NAME,
  importGalleyDeckFromCsv,
} from '../src/core/galley-deck.ts'
import { getState, resetAll } from '../src/core/store.ts'

test('importGalleyDeckFromCsv creates learn-optimized galley deck', () => {
  resetAll()
  const csvPath = join(process.cwd(), 'public', 'decks', 'ODS_Galley_Procedures_deck.csv')
  const csvText = readFileSync(csvPath, 'utf8')

  const first = importGalleyDeckFromCsv(csvText)
  assert.equal(first.decksCreated, 1)
  assert.ok(first.cardsAdded >= 40)
  assert.equal(galleyDeckCardCount(getState()), first.cardsAdded)

  const deck = getState().decks.find((d) => d.name === GALLEY_DECK_NAME)
  assert.ok(deck)

  const tags = new Set(getState().notes.filter((n) => n.deckId === deck!.id).map((n) => n.tags[0]))
  assert.ok(tags.has('galley-entry'))
  assert.ok(tags.has('galley-seating'))
  assert.ok(tags.has('galley-exit'))

  const second = importGalleyDeckFromCsv(csvText)
  assert.equal(second.cardsAdded, 0)
  assert.equal(second.reloaded, false)

  const reloaded = importGalleyDeckFromCsv(csvText, { force: true })
  assert.equal(reloaded.reloaded, true)
  assert.equal(galleyDeckCardCount(getState()), first.cardsAdded)
})