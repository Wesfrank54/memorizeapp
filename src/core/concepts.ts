import type { AppState } from './types.ts'

// Weak-concept scoring. A "concept" is a card tag; cards with no tags roll up
// under their deck. Accuracy is computed over graded attempts (from both graded
// reviews and the Quiz tab). Weakest concepts surface first.

export interface ConceptStat {
  key: string
  label: string
  kind: 'tag' | 'deck'
  attempts: number
  correct: number
  accuracy: number
}

export function computeConcepts(state: AppState, opts?: { minAttempts?: number }): ConceptStat[] {
  const minAttempts = opts?.minAttempts ?? 1
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const cardsById = new Map(state.cards.map((c) => [c.id, c]))
  const deckNames = new Map(state.decks.map((d) => [d.id, d.name]))

  const buckets = new Map<string, ConceptStat>()
  const bump = (key: string, label: string, kind: 'tag' | 'deck', correct: boolean) => {
    let b = buckets.get(key)
    if (!b) {
      b = { key, label, kind, attempts: 0, correct: 0, accuracy: 0 }
      buckets.set(key, b)
    }
    b.attempts++
    if (correct) b.correct++
  }

  for (const a of state.attempts) {
    const card = cardsById.get(a.cardId)
    if (!card) continue
    const tags = notesById.get(card.noteId)?.tags ?? []
    if (tags.length > 0) {
      for (const t of tags) bump(`tag:${t}`, t, 'tag', a.correct)
    } else {
      bump(`deck:${card.deckId}`, deckNames.get(card.deckId) ?? 'Untagged', 'deck', a.correct)
    }
  }

  const stats = [...buckets.values()]
  for (const s of stats) s.accuracy = s.attempts ? s.correct / s.attempts : 0
  return stats
    .filter((s) => s.attempts >= minAttempts)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
}

export interface CardWeakness {
  cardId: string
  attempts: number
  correct: number
  accuracy: number
}

/** Per-card accuracy, weakest first (overlaps with FSRS "leeches"). */
export function weakCards(state: AppState, opts?: { minAttempts?: number }): CardWeakness[] {
  const minAttempts = opts?.minAttempts ?? 1
  const byCard = new Map<string, CardWeakness>()
  for (const a of state.attempts) {
    let w = byCard.get(a.cardId)
    if (!w) {
      w = { cardId: a.cardId, attempts: 0, correct: 0, accuracy: 0 }
      byCard.set(a.cardId, w)
    }
    w.attempts++
    if (a.correct) w.correct++
  }
  const arr = [...byCard.values()]
  for (const w of arr) w.accuracy = w.attempts ? w.correct / w.attempts : 0
  return arr.filter((w) => w.attempts >= minAttempts).sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
}
