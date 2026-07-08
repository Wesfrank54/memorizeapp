import type { AnswerMode, AppState, Card, Note } from './types.ts'
import { answerShape, mcqAnswerGroup, sameMcqGroup, sameShape } from './distractors.ts'
import { makeChoices, normalize } from './grading.ts'
import { renderContent } from './schedule.ts'

export type GradedMode = 'mcq' | 'blank' | 'typed'

export interface ResolvedGradedMode {
  /** Mode actually used for this card. */
  mode: GradedMode
  /** What the user/session asked for. */
  requested: GradedMode
  /** Set when requested mode was downgraded. */
  fallbackReason?: string
}

/** Answers that are just a label ("Article 4") — not real recall content. */
const LABEL_ONLY_RE =
  /^(?:article|art\.?|section|sec\.?|part|rule|paragraph|para\.?|§)\s*[\divxlc]+\.?\s*$/i

/**
 * True when the back is only a structural label, not the material to memorize.
 * MCQ/blank on these devolves into "pick the number you already read in the question."
 */
export function isLabelOnlyAnswer(answer: string): boolean {
  const t = answer.trim()
  if (!t) return true
  if (LABEL_ONLY_RE.test(t)) return true
  if (t.length <= 14 && /\d/.test(t) && t.replace(/[^a-zA-Z]/g, '').length <= 10) return true
  return false
}

/** Question already gives away the answer (e.g. "Article 4" in both). */
export function answerAppearsInQuestion(question: string, answer: string): boolean {
  const q = normalize(question)
  const a = normalize(answer)
  if (!a || a.length < 2) return false
  if (q.includes(a)) return true
  const num = a.match(/(?:article|art|section|part)\s*(\d+)/i)
  if (num) {
    const n = num[1]
    if (q.includes(`article ${n}`) || q.includes(`art ${n}`) || q.includes(`section ${n}`)) return true
  }
  return false
}

/** First-letter blanks like "A_______ 4" don't help real recall. */
export function blankIsWorthwhile(answer: string): boolean {
  if (isLabelOnlyAnswer(answer)) return false
  const t = answer.trim()
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const substantive = words.filter((w) => w.replace(/[^a-zA-Z]/g, '').length >= 3)
    return substantive.length >= 2
  }
  const letters = (words[0] ?? '').replace(/[^a-zA-Z]/g, '')
  return letters.length >= 4 && !/\d/.test(words[0] ?? '')
}

function plausibleDistractor(correct: string, distractor: string, question?: string): boolean {
  const correctGroup = mcqAnswerGroup([], question, correct)
  const distractorGroup = mcqAnswerGroup([], undefined, distractor)
  // Question text pins rank/insignia type even when tags are absent on import.
  if (!sameMcqGroup(correctGroup, distractorGroup)) return false
  // Same-shape options (both dates, both counts with the same unit, …) are
  // inherently plausible regardless of length — "9" is a fine foil for "11".
  if (sameShape(correct, distractor)) return true
  const cLen = correct.trim().length
  const dLen = distractor.trim().length
  if (isLabelOnlyAnswer(distractor) && !isLabelOnlyAnswer(correct)) return false
  if (cLen >= 50) return dLen >= cLen * 0.25
  if (cLen >= 20) return dLen >= 10 && dLen <= cLen * 3
  if (cLen >= 10) return dLen >= 5
  return dLen >= 3
}

/** MCQ only when distractors are substantive and the question doesn't leak the answer. */
export function mcqIsWorthwhile(
  state: AppState,
  card: Card,
  note: Note,
  question: string,
  answer: string,
): boolean {
  const ans = answer.trim()
  if (!ans) return false
  // Structural labels ("Article 4") stay excluded, but shaped facts — dates,
  // years, bare quantities — are MCQ-able now that same-shape distractors are
  // synthesized: the format no longer singles out the answer.
  const shapedFact = answerShape(ans).kind !== 'text' && !LABEL_ONLY_RE.test(ans)
  if (!shapedFact && isLabelOnlyAnswer(ans)) return false
  if (answerAppearsInQuestion(question, ans)) return false

  const choices = makeChoices(state, card, note, 4)
  if (choices.length < 3) return false

  const distractors = choices.slice(1)
  const plausible = distractors.filter((d) => plausibleDistractor(ans, d, question))
  return plausible.length >= 2
}

function asGradedMode(requested: AnswerMode | GradedMode): GradedMode {
  if (requested === 'mcq' || requested === 'blank') return requested
  return 'typed'
}

function mcqFallbackReason(question: string, answer: string, choiceCount: number): string {
  if (isLabelOnlyAnswer(answer) || answerAppearsInQuestion(question, answer)) {
    return 'The question already gives this one away — type the answer instead.'
  }
  if (choiceCount < 3) {
    return 'Not enough distractors in this deck — type the answer instead.'
  }
  return 'Not enough plausible choices for this card — type the answer instead.'
}

/**
 * Pick the graded interaction for a card, downgrading MCQ/blank to typed when the
 * quality gates would make those modes trivial or broken. Used by Review, Quiz,
 * and GradedAnswer so behavior matches Learn's cardLadder rules.
 */
export function resolveGradedMode(
  state: AppState,
  card: Card,
  note: Note,
  requested: AnswerMode | GradedMode,
): ResolvedGradedMode {
  const graded = asGradedMode(requested)
  if (graded === 'typed') return { mode: 'typed', requested: 'typed' }

  const { question, answer: ansRaw } = renderContent(note, card)
  const ans = ansRaw.trim()

  if (graded === 'blank') {
    if (blankIsWorthwhile(ans)) return { mode: 'blank', requested: 'blank' }
    return {
      mode: 'typed',
      requested: 'blank',
      fallbackReason: 'Fill-in-the-blank does not help for this answer — type it instead.',
    }
  }

  const choices = makeChoices(state, card, note, 4)
  if (mcqIsWorthwhile(state, card, note, question, ans) && choices.length >= 3) {
    return { mode: 'mcq', requested: 'mcq' }
  }

  return {
    mode: 'typed',
    requested: 'mcq',
    fallbackReason: mcqFallbackReason(question, ans, choices.length),
  }
}