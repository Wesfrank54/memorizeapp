// Anki-style cloze deletions:  {{c1::answer}}  or  {{c1::answer::hint}}

const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g

/** Distinct cloze numbers present in the text, ascending. e.g. [1, 2]. */
export function clozeIndices(text: string): number[] {
  const found = new Set<number>()
  for (const m of text.matchAll(CLOZE_RE)) found.add(Number(m[1]))
  return [...found].sort((a, b) => a - b)
}

/** The full sentence with every cloze filled in (markers stripped) — used by the fill-in-the-blank trainer. */
export function clozeFullText(text: string): string {
  return text.replace(CLOZE_RE, (_m, _n, answer) => answer)
}

/** The answer text of a specific cloze (for grading a recall checkpoint). */
export function clozeAnswer(text: string, clozeNum: number): string {
  for (const m of text.matchAll(CLOZE_RE)) {
    if (Number(m[1]) === clozeNum) return m[2]
  }
  return ''
}

/**
 * Render one cloze card. `clozeNum` is the 1-based cloze being tested.
 *   question: target hidden as [...] (or [hint]); other clozes revealed.
 *   answer:   every cloze revealed (target wrapped in [brackets] for emphasis).
 */
export function renderCloze(text: string, clozeNum: number): { question: string; answer: string } {
  const question = text.replace(CLOZE_RE, (_, n, answer, hint) =>
    Number(n) === clozeNum ? `[${hint ?? '...'}]` : answer,
  )
  const answer = text.replace(CLOZE_RE, (_, n, ans) =>
    Number(n) === clozeNum ? `[${ans}]` : ans,
  )
  return { question, answer }
}
