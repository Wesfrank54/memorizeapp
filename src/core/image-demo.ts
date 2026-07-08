import type { AppState } from './types.ts'
import { FIELD_FRONT_IMAGE } from './media.ts'
import { addBasicNoteWithFields, addDeck, getState } from './store.ts'

export const IMAGE_DEMO_DECK_NAME = 'Image Testing (beta)'
export const IMAGE_DEMO_TAG = 'image-beta'

export interface ImageDemoRow {
  front: string
  back: string
  frontImage: string
  tags: string[]
}

/** Collar-device image cards paired with the rank title answer. */
export const IMAGE_DEMO_ROWS: ImageDemoRow[] = [
  {
    front: 'What rank wears this collar device?',
    back: 'Ensign (ENS)',
    frontImage: 'insignia/navy-officer-collar/o1-ens.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Lieutenant Junior Grade (LTJG)',
    frontImage: 'insignia/navy-officer-collar/o2-ltjg.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Lieutenant (LT)',
    frontImage: 'insignia/navy-officer-collar/o3-lt.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Lieutenant Commander (LCDR)',
    frontImage: 'insignia/navy-officer-collar/o4-lcdr.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Commander (CDR)',
    frontImage: 'insignia/navy-officer-collar/o5-cdr.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Captain (CAPT)',
    frontImage: 'insignia/navy-officer-collar/o6-capt.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Rear Admiral Lower Half (RDML)',
    frontImage: 'insignia/navy-officer-collar/o7-rdml.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
  {
    front: 'What rank wears this collar device?',
    back: 'Rear Admiral (RADM)',
    frontImage: 'insignia/navy-officer-collar/o8-radm.svg',
    tags: ['navy-officer-rank', IMAGE_DEMO_TAG],
  },
]

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

/** Idempotent: adds demo deck and image question cards. */
export function ensureImageDemoDeck(): { deckId: string; imageCards: number; added: number } {
  let deckId = imageDemoDeckId()
  if (!deckId) {
    deckId = addDeck(IMAGE_DEMO_DECK_NAME).id
  }

  const state = getState()
  const existingImages = new Set(
    state.notes
      .filter((n) => n.deckId === deckId && n.fields[FIELD_FRONT_IMAGE])
      .map((n) => n.fields[FIELD_FRONT_IMAGE]!.trim()),
  )

  let added = 0
  for (const row of IMAGE_DEMO_ROWS) {
    if (existingImages.has(row.frontImage)) continue
    addBasicNoteWithFields(deckId, row.front, row.back, row.tags, { [FIELD_FRONT_IMAGE]: row.frontImage })
    existingImages.add(row.frontImage)
    added++
  }

  return { deckId, imageCards: IMAGE_DEMO_ROWS.length, added }
}