import type { AppState } from './types.ts'
import { FIELD_FRONT_IMAGE } from './media.ts'
import { getState, importCsv } from './store.ts'

export const IMAGE_DEMO_DECK_NAME = 'ODS Ranks Demo (PDF)'
export const IMAGE_DEMO_CSV_URL = '/decks/ODS_Ranks_Demo_deck.csv'
export const IMAGE_DEMO_TAG = 'image-beta'

/** Navy officer collar devices W-2 through O-11 from the ODS Knowledge Book PDF. */
export const EXPECTED_IMAGE_CARDS = 15

export interface ImageDemoLoadResult {
  deckId: string
  imageCards: number
  added: number
  decksCreated: number
  cardsAdded: number
}

export function imageDemoDeckId(state: AppState = getState()): string | undefined {
  return state.decks.find((d) => d.name === IMAGE_DEMO_DECK_NAME)?.id
}

export function imageDemoItems(state: AppState): { card: AppState['cards'][0]; note: AppState['notes'][0] }[] {
  const deckId = imageDemoDeckId(state)
  if (!deckId) return []
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  return state.cards
    .filter((c) => c.deckId === deckId)
    .map((c) => ({ card: c, note: notesById.get(c.noteId) }))
    .filter((x): x is { card: AppState['cards'][0]; note: AppState['notes'][0] } => {
      if (!x.note) return false
      return Boolean(x.note.fields[FIELD_FRONT_IMAGE]?.trim())
    })
}

/** Idempotent: imports the PDF demo deck from CSV text (skips if deck already exists). */
export function ensureImageDemoDeckFromCsv(csvText: string): ImageDemoLoadResult {
  const existingDeckId = imageDemoDeckId()
  if (existingDeckId) {
    const imageCards = imageDemoItems(getState()).length
    return { deckId: existingDeckId, imageCards, added: 0, decksCreated: 0, cardsAdded: 0 }
  }

  const { decksCreated, cardsAdded } = importCsv(csvText)
  const deckId = imageDemoDeckId()
  if (!deckId) {
    throw new Error(`CSV import did not create deck "${IMAGE_DEMO_DECK_NAME}"`)
  }
  const imageCards = imageDemoItems(getState()).length
  return { deckId, imageCards, added: imageCards, decksCreated, cardsAdded }
}

/** Idempotent: fetches and imports the PDF ranks demo deck. */
export async function ensureImageDemoDeck(): Promise<ImageDemoLoadResult> {
  if (imageDemoDeckId()) {
    return ensureImageDemoDeckFromCsv('')
  }

  const res = await fetch(IMAGE_DEMO_CSV_URL)
  if (!res.ok) {
    throw new Error(`Failed to load demo deck (${res.status})`)
  }
  return ensureImageDemoDeckFromCsv(await res.text())
}