import type { AppState, Card, Note } from './types.ts'
import { clozeFullText } from './cloze.ts'
import { gradePassageChunk, PASSAGE_PASS_SCORE } from './passage.ts'
import { gradeText } from './grading.ts'
import { renderContent } from './schedule.ts'
import type { Unit } from './learn.ts'

const MAX_TYPED_LEN = 40

export interface UnitSynthesisPart {
  cardId: string
  label: string
  text: string
  /** typed for short answers; passage for long recitations */
  style: 'typed' | 'passage'
}

export interface SynthesisPartResult {
  cardId: string
  passed: boolean
}

/** Build per-card sections for a full-unit recall test (2+ cards only). */
export function buildUnitSynthesis(state: AppState, unit: Unit): UnitSynthesisPart[] | null {
  if (unit.cardIds.length < 2) return null
  const cardsById = new Map(state.cards.map((c) => [c.id, c]))
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const parts: UnitSynthesisPart[] = []

  // A multi-deletion cloze note (+ a recite card with the same answer) expands
  // to several cards with the identical text — one recall test covers them all.
  const seenText = new Map<string, { index: number; clozeLabel: boolean }>()

  for (let i = 0; i < unit.cardIds.length; i++) {
    const id = unit.cardIds[i]
    const card = cardsById.get(id)
    const note = card ? notesById.get(card.noteId) : undefined
    if (!card || !note) continue
    const { question, answer } = renderContent(note, card)
    const text =
      note.type === 'cloze'
        ? clozeFullText(note.fields.text ?? '').trim()
        : (answer || question).trim()
    if (!text) continue
    const label = question.trim() || `Part ${i + 1}`
    const key = text.replace(/\s+/g, ' ').toLowerCase()
    const seen = seenText.get(key)
    if (seen) {
      // Duplicate passage: keep one part, but prefer a non-cloze label — a real
      // prompt reads better than a cloze stem with [...] in it.
      if (seen.clozeLabel && note.type !== 'cloze') {
        parts[seen.index] = { ...parts[seen.index], label }
        seen.clozeLabel = false
      }
      continue
    }
    seenText.set(key, { index: parts.length, clozeLabel: note.type === 'cloze' })
    const style = passageStyle(card, note, text)
    parts.push({ cardId: id, label, text, style })
  }

  return parts.length >= 2 ? parts : null
}

function passageStyle(_card: Card, note: Note, text: string): 'typed' | 'passage' {
  if (note.type === 'cloze') return 'passage'
  if (text.length > MAX_TYPED_LEN) return 'passage'
  return 'typed'
}

/** Grade each section of a full-unit test. */
export function gradeUnitSynthesis(
  parts: UnitSynthesisPart[],
  responses: Record<string, string>,
): SynthesisPartResult[] {
  return parts.map((part) => {
    const given = responses[part.cardId] ?? ''
    if (part.style === 'typed') {
      return { cardId: part.cardId, passed: gradeText(part.text, given).correct }
    }
    const { total, correct } = gradePassageChunk(part.text, given)
    const score = total > 0 ? correct / total : 0
    return { cardId: part.cardId, passed: score >= PASSAGE_PASS_SCORE }
  })
}