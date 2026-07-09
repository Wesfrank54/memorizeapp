// Synthetic distractor engine — answers with a recognizable *shape* (dates,
// years, quantities) need same-shape wrong options: if "13 October 1775" is the
// only date among prose choices, the format alone gives the answer away.
// Generation is deterministic (seeded by card id) so a card's options are
// stable and testable, and fully offline — no AI/API involved.

/**
 * Semantic bucket for MCQ distractors. Cards in the same group have
 * interchangeable wrong answers (rank vs rank, collar device vs collar device).
 * `null` means no constraint — legacy decks without tags still work.
 */
export type McqAnswerGroup = string | null

/** Tags that pin rank/insignia answer types (navy-officer-rank, marine-officer-collar, …). */
const MCQ_INSIGNIA_TAG_RE = /-(?:rank|collar|sleeve|shoulder)$/i
/** Alternate rank tags from ODS_Knowledge_deck (ranks-marine-enlisted, ranks-navy-officer, …). */
const MCQ_RANKS_PREFIX_TAG_RE = /^ranks-(?:navy|marine|army|airforce|coastguard)-(?:officer|enlisted)$/i

const RANK_TITLE_RE =
  /\b(?:admiral|lieutenant|captain|ensign|commander|colonel|general|sergeant|corporal|private|petty officer|seaman|warrant|chief petty|master chief|brigadier|major)\b/i
const RANK_ABBR_RE = /\([A-Za-z0-9]{2,6}\)\s*$/
const INSIGNIA_DESC_RE =
  /^(?:none|one|two|three|four|five)\s+(?:gold|silver|thin|diagonal|single)\b/i
const INSIGNIA_DETAIL_RE =
  /\b(?:bar|bars|stripe|stripes|star|stars|chevron|chevrons|oak leaf|eagle|rocker|anchor|break|outboard|1\/2-inch|1\/4-inch|2-inch)\b/i

function insigniaKindToken(raw: string): string {
  const k = raw.toLowerCase().trim()
  if (k === 'rank') return 'rank'
  if (k.includes('collar')) return 'collar'
  if (k.includes('shoulder')) return 'shoulder'
  if (k.includes('sleeve')) return 'sleeve'
  return k.replace(/\s+/g, '-')
}

function mcqGroupFromQuestion(question: string): McqAnswerGroup {
  const m = question.match(
    /\b(Navy|Marine|Army|Air Force|Coast Guard)\s+(officer|enlisted)\s+(rank|collar device|shoulder board|sleeve insignia)\b/i,
  )
  if (!m) return null
  const branch = m[1].toLowerCase().replace(/\s+/g, '')
  const tier = m[2].toLowerCase()
  const kind = insigniaKindToken(m[3])
  return `${branch}-${tier}-${kind}`
}

function mcqGroupFromAnswer(answer: string): McqAnswerGroup {
  const t = answer.trim()
  if (!t) return null
  if (RANK_ABBR_RE.test(t) && RANK_TITLE_RE.test(t)) return '__rank-name__'
  if (INSIGNIA_DESC_RE.test(t) && INSIGNIA_DETAIL_RE.test(t)) return '__insignia-short__'
  if (/^(?:gold|silver)\s+bar\b/i.test(t) && INSIGNIA_DETAIL_RE.test(t)) return '__insignia-short__'
  if (INSIGNIA_DETAIL_RE.test(t) && t.length <= 120 && !RANK_TITLE_RE.test(t)) return '__insignia-detail__'
  return null
}

function pickGroupingTag(tags: string[]): string | null {
  for (const tag of tags) {
    const t = tag.toLowerCase()
    if (MCQ_INSIGNIA_TAG_RE.test(t) || MCQ_RANKS_PREFIX_TAG_RE.test(t) || t === 'corps-devices') return t
  }
  if (tags.length === 1) return tags[0].toLowerCase()
  return null
}

/** Unify rank tag spellings so duplicate imports still share distractors. */
export function canonicalMcqGroup(g: McqAnswerGroup): McqAnswerGroup {
  if (g === null) return null
  const t = g.toLowerCase()
  const m = t.match(/^ranks-(navy|marine|army|airforce|coastguard)-(officer|enlisted)$/)
  if (m) return `${m[1]}-${m[2]}-rank`
  return t
}

/** Classify an answer for same-type MCQ grouping (tags preferred, then question/answer cues). */
export function mcqAnswerGroup(tags: string[], question?: string, answer?: string): McqAnswerGroup {
  const fromTag = pickGroupingTag(tags)
  if (fromTag) return canonicalMcqGroup(fromTag)
  if (question) {
    const fromQ = mcqGroupFromQuestion(question)
    if (fromQ) return canonicalMcqGroup(fromQ)
  }
  if (answer) return mcqGroupFromAnswer(answer)
  return null
}

/** Collapse tag + heuristic labels into a coarse family for comparison. */
function mcqGroupFamily(g: McqAnswerGroup): string | null {
  if (g === null) return null
  if (g === '__rank-name__' || g.endsWith('-rank')) return 'rank'
  if (g === '__insignia-short__' || g === '__insignia-detail__' || g.endsWith('-collar')) return 'collar'
  if (g.endsWith('-shoulder')) return 'shoulder'
  if (g.endsWith('-sleeve')) return 'sleeve'
  return g
}

/** True when two answers may appear together as MCQ foils. */
export function sameMcqGroup(a: McqAnswerGroup, b: McqAnswerGroup): boolean {
  if (a === null || b === null) return true
  return mcqGroupFamily(canonicalMcqGroup(a)) === mcqGroupFamily(canonicalMcqGroup(b))
}

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

// ---- confusability similarity ---------------------------------------------
// Ranks real candidate answers by how easily they'd be mistaken for the correct
// one, so MCQ foils are the *tempting* neighbors (adjacent ranks, same-family
// facts) rather than arbitrary picks. Pure + deterministic — no corpus, no RNG.

function simNormalize(s: string): string {
  return s.trim().toLowerCase().replace(/[.,;:!?'"()[\]]/g, '').replace(/\s+/g, ' ')
}

function tokenize(s: string): string[] {
  return simNormalize(s).split(' ').filter(Boolean)
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function trigrams(s: string): Set<string> {
  const t = `  ${simNormalize(s).replace(/\s+/g, ' ')}  `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}

/** Count of shared leading tokens (e.g. "Chief Warrant Officer Two/Three" → 3). */
function sharedPrefixTokens(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * Confusability of `candidate` as a wrong answer for `correct`, in [0, 1].
 * Blends word overlap, character-trigram overlap, shared prefix, and length
 * proximity. Higher = more plausible as an MCQ foil. Symmetric-ish; used only
 * for ranking so exact calibration doesn't matter.
 */
export function answerSimilarity(correct: string, candidate: string): number {
  const ca = simNormalize(correct)
  const cb = simNormalize(candidate)
  if (!ca || !cb) return 0
  if (ca === cb) return 1

  const ta = tokenize(correct)
  const tb = tokenize(candidate)
  const tokenJac = jaccard(new Set(ta), new Set(tb))
  const triJac = jaccard(trigrams(correct), trigrams(candidate))
  const prefix = sharedPrefixTokens(ta, tb)
  const prefixScore = Math.max(ta.length, tb.length) === 0 ? 0 : prefix / Math.max(ta.length, tb.length)
  const lenProx = 1 - Math.abs(ca.length - cb.length) / Math.max(ca.length, cb.length)

  return 0.4 * tokenJac + 0.3 * triJac + 0.2 * prefixScore + 0.1 * lenProx
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
