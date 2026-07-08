import type { AppState } from './types.ts'
import { FIELD_FRONT_IMAGE } from './media.ts'
import { deleteDeck, getState, importCsv } from './store.ts'

export const IMAGE_DEMO_DECK_NAME = 'ODS Ranks Demo (PDF)'
/** Pre-PDF demo deck name — removed on reload so stale SVG cards do not linger. */
export const LEGACY_IMAGE_DEMO_DECK_NAME = 'Image Testing (beta)'
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

function demoDeckIdsToReplace(state: AppState = getState()): string[] {
  const names = new Set([IMAGE_DEMO_DECK_NAME, LEGACY_IMAGE_DEMO_DECK_NAME])
  return state.decks.filter((d) => names.has(d.name)).map((d) => d.id)
}

/** True when an existing demo deck is missing PNG image cards or still references SVG placeholders. */
export function imageDemoDeckNeedsReload(state: AppState = getState()): boolean {
  const deckId = imageDemoDeckId(state)
  if (!deckId) return demoDeckIdsToReplace(state).length > 0

  const imageNotes = state.notes.filter(
    (n) => n.deckId === deckId && n.fields[FIELD_FRONT_IMAGE]?.trim(),
  )
  if (imageNotes.length < EXPECTED_IMAGE_CARDS) return true
  return imageNotes.some((n) => {
    const path = n.fields[FIELD_FRONT_IMAGE]!.trim().toLowerCase()
    return path.endsWith('.svg') || !path.endsWith('.png')
  })
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

function removeDemoDecks(): number {
  let removed = 0
  for (const deckId of demoDeckIdsToReplace()) {
    deleteDeck(deckId)
    removed++
  }
  return removed
}

/** Import the PDF demo deck from CSV text. Replaces any existing demo deck when force or stale. */
export function ensureImageDemoDeckFromCsv(
  csvText: string,
  options: { force?: boolean } = {},
): ImageDemoLoadResult {
  const state = getState()
  const existingDeckId = imageDemoDeckId(state)
  const shouldReplace = options.force || imageDemoDeckNeedsReload(state)

  if (existingDeckId && !shouldReplace) {
    const imageCards = imageDemoItems(state).length
    return { deckId: existingDeckId, imageCards, added: 0, decksCreated: 0, cardsAdded: 0 }
  }

  if (!csvText.trim()) {
    throw new Error('Demo deck CSV is empty — fetch the deck file before reloading.')
  }

  removeDemoDecks()

  const { decksCreated, cardsAdded } = importCsv(csvText)
  const deckId = imageDemoDeckId()
  if (!deckId) {
    throw new Error(`CSV import did not create deck "${IMAGE_DEMO_DECK_NAME}"`)
  }
  const imageCards = imageDemoItems(getState()).length
  if (imageCards < EXPECTED_IMAGE_CARDS) {
    throw new Error(`Demo deck imported but only ${imageCards}/${EXPECTED_IMAGE_CARDS} image cards have PNG paths.`)
  }
  return { deckId, imageCards, added: imageCards, decksCreated, cardsAdded }
}

/** Fetches and imports the PDF ranks demo deck. Pass force:true to delete and re-import. */
export async function ensureImageDemoDeck(options: { force?: boolean } = {}): Promise<ImageDemoLoadResult> {
  const state = getState()
  const needsWork = options.force || !imageDemoDeckId(state) || imageDemoDeckNeedsReload(state)
  if (!needsWork) {
    const deckId = imageDemoDeckId(state)!
    return {
      deckId,
      imageCards: imageDemoItems(state).length,
      added: 0,
      decksCreated: 0,
      cardsAdded: 0,
    }
  }

  const res = await fetch(IMAGE_DEMO_CSV_URL)
  if (!res.ok) {
    throw new Error(`Failed to load demo deck (${res.status})`)
  }
  return ensureImageDemoDeckFromCsv(await res.text(), options)
}