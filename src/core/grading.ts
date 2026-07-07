import { Rating } from 'ts-fsrs'
import type { AppState, Card, Grade, Note } from './types.ts'
import { cardAnswer } from './accountability.ts'
import { isLabelOnlyAnswer } from './answer-modes.ts'
import { answerShape, sameShape, synthesizeDistractors } from './distractors.ts'

// Auto-grading for the typed / fill-in-the-blank / multiple-choice answer modes.
// Text answers are graded by normalized exact match with a small near-miss
// tolerance (so a typo isn't punished like a blank). MCQ is exact-option match.

export interface GradeResult {
  correct: boolean
  /** True for a near-miss (typo-level): counts as correct but maps to a "Hard" rating. */
  near: boolean
}

/** Forgiving normalization: case, surrounding/inner whitespace, light punctuation. */
export function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?'"()[\]]/g, '')
}

/** Classic Levenshtein edit distance (two-row, O(mn) time, O(n) space). */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/** Grade a typed/blank answer against the expected string. */
export function gradeText(expected: string, given: string): GradeResult {
  const e = normalize(expected)
  const g = normalize(given)
  if (g.length === 0) return { correct: false, near: false }
  if (e === g) return { correct: true, near: false }
  // Tolerance scales with length: ~1 edit per 6 chars, min 1.
  const tolerance = Math.max(1, Math.floor(e.length / 6))
  if (levenshtein(e, g) <= tolerance) return { correct: true, near: true }
  return { correct: false, near: false }
}

/** Grade a multiple-choice selection (exact-option match, normalized). */
export function gradeChoice(expected: string, picked: string): GradeResult {
  return { correct: normalize(expected) === normalize(picked), near: false }
}

/** Map an auto-grade to an FSRS rating: exact → Good, near-miss → Hard, wrong → Again. */
export function ratingFromResult(r: GradeResult): Grade {
  if (r.correct && !r.near) return Rating.Good
  if (r.correct && r.near) return Rating.Hard
  return Rating.Again
}

/**
 * Build multiple-choice options: the correct answer plus up to n-1 distractors
 * drawn from other cards' answers. Distractors that share a tag are preferred
 * (more plausible), then same deck, then any. Returns option strings with the
 * correct answer first (caller shuffles for display); de-duplicated by normalized form.
 */
export function makeChoices(state: AppState, card: Card, note: Note, n = 4): string[] {
  const correct = cardAnswer(note, card)
  const notesById = new Map(state.notes.map((nn) => [nn.id, nn]))
  const myTags = new Set(note.tags)

  type Cand = { text: string; sameTag: boolean; sameDeck: boolean }
  const seen = new Set<string>([normalize(correct)])
  const cands: Cand[] = []
  for (const c of state.cards) {
    if (c.id === card.id) continue
    const nn = notesById.get(c.noteId)
    if (!nn) continue
    const text = cardAnswer(nn, c)
    const key = normalize(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    cands.push({ text, sameTag: nn.tags.some((t) => myTags.has(t)), sameDeck: c.deckId === card.deckId })
  }
  cands.sort((a, b) => Number(b.sameTag) - Number(a.sameTag) || Number(b.sameDeck) - Number(a.sameDeck))

  // Shaped answers (dates, years, quantities): every option must share the
  // shape — a lone date among prose options is obviously the answer. Real
  // same-shape facts from other cards first (the most confusable distractors,
  // e.g. Marine Corps birthday vs Navy birthday), then synthesized
  // perturbations of the answer to fill the remaining slots.
  if (answerShape(correct).kind !== 'text') {
    const picked: string[] = []
    const used = new Set<string>([normalize(correct)])
    for (const c of cands) {
      if (picked.length >= n - 1) break
      if (!sameShape(correct, c.text)) continue
      const key = normalize(c.text)
      if (used.has(key)) continue
      used.add(key)
      picked.push(c.text)
    }
    if (picked.length < n - 1) {
      for (const s of synthesizeDistractors(correct, n + 3, card.id)) {
        if (picked.length >= n - 1) break
        const key = normalize(s)
        if (used.has(key)) continue
        used.add(key)
        picked.push(s)
      }
    }
    return [correct, ...picked]
  }

  const correctLen = correct.trim().length
  const minLen =
    correctLen >= 60 ? Math.floor(correctLen * 0.25) : correctLen >= 25 ? 10 : correctLen >= 12 ? 5 : 3

  const picked: string[] = []
  for (const c of cands) {
    if (picked.length >= n - 1) break
    const len = c.text.trim().length
    if (isLabelOnlyAnswer(correct) && isLabelOnlyAnswer(c.text)) {
      picked.push(c.text)
      continue
    }
    if (!isLabelOnlyAnswer(correct) && isLabelOnlyAnswer(c.text)) continue
    if (correctLen >= 20 && len < minLen) continue
    picked.push(c.text)
  }
  return [correct, ...picked]
}
