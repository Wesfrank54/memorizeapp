// Synthetic distractor engine — answers with a recognizable *shape* (dates,
// years, quantities) need same-shape wrong options: if "13 October 1775" is the
// only date among prose choices, the format alone gives the answer away.
// Generation is deterministic (seeded by card id) so a card's options are
// stable and testable, and fully offline — no AI/API involved.

export type AnswerShape =
  | {
      kind: 'date'
      day?: number
      monthIdx: number
      year: number
      template: 'dmy' | 'mdy' | 'my'
      monthStyle: 'full' | 'abbr'
      comma: boolean
    }
  | { kind: 'year'; year: number }
  | { kind: 'number'; value: number; prefix: string; suffix: string; decimals: number }
  | { kind: 'text' }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthIndex(token: string): number {
  const t = token.replace(/\.$/, '').toLowerCase()
  return MONTHS.findIndex((m) => m.toLowerCase() === t || m.slice(0, 3).toLowerCase() === t)
}

function monthName(idx: number, style: 'full' | 'abbr'): string {
  const m = MONTHS[((idx % 12) + 12) % 12]
  return style === 'abbr' ? m.slice(0, 3) : m
}

const isYearNum = (y: number) => y >= 1000 && y <= 2100

/** Classify an answer's shape. Dates/years/quantities get synthetic distractors. */
export function answerShape(s: string): AnswerShape {
  const t = s.trim()

  // "13 October 1775"
  let m = t.match(/^(\d{1,2})\s+([A-Za-z]+\.?)\s+(\d{4})$/)
  if (m) {
    const monthIdx = monthIndex(m[2])
    const day = Number(m[1])
    const year = Number(m[3])
    if (monthIdx >= 0 && day >= 1 && day <= 31 && isYearNum(year)) {
      return { kind: 'date', day, monthIdx, year, template: 'dmy', monthStyle: m[2].replace(/\.$/, '').length <= 3 ? 'abbr' : 'full', comma: false }
    }
  }

  // "October 13, 1775" / "October 13 1775"
  m = t.match(/^([A-Za-z]+\.?)\s+(\d{1,2})(,)?\s+(\d{4})$/)
  if (m) {
    const monthIdx = monthIndex(m[1])
    const day = Number(m[2])
    const year = Number(m[4])
    if (monthIdx >= 0 && day >= 1 && day <= 31 && isYearNum(year)) {
      return { kind: 'date', day, monthIdx, year, template: 'mdy', monthStyle: m[1].replace(/\.$/, '').length <= 3 ? 'abbr' : 'full', comma: !!m[3] }
    }
  }

  // "October 1775"
  m = t.match(/^([A-Za-z]+\.?)\s+(\d{4})$/)
  if (m) {
    const monthIdx = monthIndex(m[1])
    const year = Number(m[2])
    if (monthIdx >= 0 && isYearNum(year)) {
      return { kind: 'date', monthIdx, year, template: 'my', monthStyle: m[1].replace(/\.$/, '').length <= 3 ? 'abbr' : 'full', comma: false }
    }
  }

  // bare year "1775"
  m = t.match(/^(\d{4})$/)
  if (m && isYearNum(Number(m[1]))) return { kind: 'year', year: Number(m[1]) }

  // single quantity, optionally with short unit text: "11", "36 inches", "$50"
  m = t.match(/^([^\d]{0,12}?)(\d+(?:\.\d+)?)([^\d]{0,16})$/)
  if (m && m[2]) {
    const decimals = m[2].includes('.') ? m[2].split('.')[1].length : 0
    return { kind: 'number', value: Number(m[2]), prefix: m[1], suffix: m[3], decimals }
  }

  return { kind: 'text' }
}

/** Two answers share a shape (and would look alike as MCQ options). */
export function sameShape(a: string, b: string): boolean {
  const sa = answerShape(a)
  const sb = answerShape(b)
  if (sa.kind === 'text' || sb.kind === 'text') return false
  if (sa.kind !== sb.kind) return false
  if (sa.kind === 'number' && sb.kind === 'number') {
    // Quantities only confuse each other with matching units: "36 inches" ≠ "11".
    const normUnit = (x: string) => x.trim().toLowerCase()
    return normUnit(sa.suffix) === normUnit(sb.suffix) && normUnit(sa.prefix) === normUnit(sb.prefix)
  }
  return true
}

// Deterministic PRNG so a card's synthetic options are stable across renders.
function hashSeed(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h || 1
}

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function shuffleSeeded<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function formatDate(shape: Extract<AnswerShape, { kind: 'date' }>, day: number | undefined, monthIdx: number, year: number): string {
  const mo = monthName(monthIdx, shape.monthStyle)
  if (shape.template === 'dmy') return `${day} ${mo} ${year}`
  if (shape.template === 'mdy') return `${mo} ${day}${shape.comma ? ',' : ''} ${year}`
  return `${mo} ${year}`
}

function dateVariants(shape: Extract<AnswerShape, { kind: 'date' }>, rnd: () => number): string[] {
  const out: string[] = []
  const day = shape.day ?? 1
  const push = (d: number | undefined, mi: number, y: number) => {
    if (d !== undefined) d = Math.min(28, Math.max(1, d))
    if (d === shape.day && mi === shape.monthIdx && y === shape.year) return
    out.push(formatDate(shape, shape.template === 'my' ? undefined : d, ((mi % 12) + 12) % 12, y))
  }
  const dayDeltas = shuffleSeeded([-9, -4, -2, 3, 6, 8, 12], rnd)
  const monthDeltas = shuffleSeeded([-3, -2, -1, 1, 2, 4, 6], rnd)
  const yearDeltas = shuffleSeeded([-19, -7, -3, -1, 2, 6, 12, 21], rnd)
  // same month/year, different day (closest confusion)
  if (shape.template !== 'my') for (const d of dayDeltas.slice(0, 3)) push(day + d, shape.monthIdx, shape.year)
  // different month, same day/year
  for (const md of monthDeltas.slice(0, 3)) push(day, shape.monthIdx + md, shape.year)
  // different year
  for (const yd of yearDeltas.slice(0, 3)) push(day, shape.monthIdx, shape.year + yd)
  // month + year both shifted
  push(day, shape.monthIdx + monthDeltas[3], shape.year + yearDeltas[3])
  return out
}

function numberVariants(shape: Extract<AnswerShape, { kind: 'number' }>, rnd: () => number): string[] {
  const v = shape.value
  let deltas: number[]
  if (Number.isInteger(v) && Math.abs(v) <= 20) deltas = [-3, -2, -1, 1, 2, 3, 4]
  else if (Math.abs(v) <= 100) deltas = [-15, -8, -4, -2, 2, 5, 9, 14]
  else deltas = [-0.25, -0.15, -0.08, 0.07, 0.12, 0.2].map((p) => Math.round(v * p) || 1)
  const out: string[] = []
  for (const d of shuffleSeeded(deltas, rnd)) {
    let nv = v + d
    if (v > 0 && nv <= 0) nv = v + Math.abs(d) + 1 // keep counts positive
    if (nv === v) continue
    const txt = shape.decimals > 0 ? nv.toFixed(shape.decimals) : String(Math.round(nv))
    out.push(`${shape.prefix}${txt}${shape.suffix}`)
  }
  return out
}

function yearVariants(year: number, rnd: () => number): string[] {
  const deltas = shuffleSeeded([-23, -12, -7, -3, -1, 2, 5, 9, 16], rnd)
  return deltas.map((d) => String(year + d)).filter((y) => y !== String(year))
}

/**
 * Generate up to n same-shape wrong answers for a shaped answer (dates, years,
 * quantities). Returns [] for plain text — those keep drawing real distractors
 * from other cards. Deterministic for a given (answer, seedKey).
 */
export function synthesizeDistractors(answer: string, n: number, seedKey: string): string[] {
  const shape = answerShape(answer)
  if (shape.kind === 'text') return []
  const rnd = prng(hashSeed(seedKey + '|' + answer))

  let variants: string[]
  if (shape.kind === 'date') variants = dateVariants(shape, rnd)
  else if (shape.kind === 'year') variants = yearVariants(shape.year, rnd)
  else variants = numberVariants(shape, rnd)

  const seen = new Set<string>([answer.trim().toLowerCase()])
  const out: string[] = []
  for (const v of variants) {
    const key = v.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= n) break
  }
  return out
}
