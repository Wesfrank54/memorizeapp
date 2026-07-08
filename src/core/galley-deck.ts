import type { AppState } from './types.ts'
import { deleteDeck, getState, importCsv } from './store.ts'

export const GALLEY_DECK_NAME = 'ODS Galley Procedures'
export const GALLEY_DECK_CSV_URL = '/decks/ODS_Galley_Procedures_deck.csv'

export interface GalleyDeckLoadResult {
  deckId: string
  cardsAdded: number
  decksCreated: number
  reloaded: boolean
}

export function galleyDeckId(state: AppState = getState()): string | undefined {
  return state.decks.find((d) => d.name === GALLEY_DECK_NAME)?.id
}

export function galleyDeckCardCount(state: AppState = getState()): number {
  const deckId = galleyDeckId(state)
  if (!deckId) return 0
  return state.cards.filter((c) => c.deckId === deckId).length
}

/** Import galley deck CSV. Replaces existing deck when force or reload. */
export function importGalleyDeckFromCsv(
  csvText: string,
  options: { force?: boolean } = {},
): GalleyDeckLoadResult {
  const existingId = galleyDeckId()
  if (existingId && !options.force) {
    return {
      deckId: existingId,
      cardsAdded: 0,
      decksCreated: 0,
      reloaded: false,
    }
  }

  if (!csvText.trim()) {
    throw new Error('Galley deck CSV is empty.')
  }

  if (existingId) {
    deleteDeck(existingId)
  }

  const { decksCreated, cardsAdded } = importCsv(csvText)
  const deckId = galleyDeckId()
  if (!deckId) {
    throw new Error(`CSV import did not create deck "${GALLEY_DECK_NAME}"`)
  }

  return { deckId, cardsAdded, decksCreated, reloaded: Boolean(existingId) }
}

export async function ensureGalleyDeck(options: { force?: boolean } = {}): Promise<GalleyDeckLoadResult> {
  const existingId = galleyDeckId()
  if (existingId && !options.force) {
    return {
      deckId: existingId,
      cardsAdded: galleyDeckCardCount(),
      decksCreated: 0,
      reloaded: false,
    }
  }

  const res = await fetch(GALLEY_DECK_CSV_URL)
  if (!res.ok) {
    throw new Error(`Failed to load galley deck (${res.status})`)
  }
  return importGalleyDeckFromCsv(await res.text(), options)
}