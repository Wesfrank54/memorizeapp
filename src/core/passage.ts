// Recite trainer helpers — turn a long verbatim passage into a chunked,
// first-letter-cued reconstruction exercise (creeds, oaths, songs).

/** Split a passage into recitation chunks (sentences / lines), further breaking very long ones. */
export function splitPassage(text: string): string[] {
  const norm = text.replace(/\s+/g, ' ').trim()
  if (!norm) return []
  const sentences = norm.split(/(?<=[.;!?])\s+/).map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const s of sentences) {
    const words = s.split(' ')
    if (words.length <= 16) {
      out.push(s)
      continue
    }
    // Long sentence: break at comma boundaries into ~12-word chunks.
    let cur: string[] = []
    for (const w of words) {
      cur.push(w)
      if (cur.length >= 12 && /[,;:]$/.test(w)) {
        out.push(cur.join(' '))
        cur = []
      }
    }
    if (cur.length) out.push(cur.join(' '))
  }
  return out.length ? out : [norm]
}

/** Replace every word with its first character, keeping punctuation and spacing. */
export function firstLetterCue(chunk: string): string {
  return chunk.replace(/([A-Za-z0-9])[A-Za-z0-9'’-]*/g, '$1')
}

// Function words that stay visible as scaffolding — blanks land on content words.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'it', 'its', 'this', 'that', 'these', 'those',
  'my', 'our', 'your', 'his', 'her', 'their',
])

const bareWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Which word positions to blank for a given coverage (0..1), chosen only from
 * *content* words (function words like a/of/to/the stay visible) and spread
 * evenly so blanks don't clump. `variant` rotates the selection so repeated
 * views of the same prompt blank different words (over a few passes, all content
 * words get tested). Deterministic given the same variant. coverage 1 → all.
 */
export function selectBlanks(words: string[], coverage: number, variant = 0): Set<number> {
  const c = Math.max(0, Math.min(1, coverage))
  const eligible = words.map((_, i) => i).filter((i) => {
    const w = bareWord(words[i])
    return w.length > 0 && !STOPWORDS.has(w)
  })
  const m = eligible.length
  const n = Math.round(m * c)
  const set = new Set<number>()
  if (n <= 0 || m === 0) return set
  if (n >= m) {
    for (const i of eligible) set.add(i)
    return set
  }
  const shift = ((variant % m) + m) % m
  for (let i = 0; i < n; i++) {
    const base = Math.floor(((i + 0.5) * m) / n)
    set.add(eligible[(base + shift) % m])
  }
  // Return positions in reading order — the rotation above inserts them out of
  // order, so callers that treat iteration order as left-to-right (e.g. focusing
  // the first blank) get the leftmost word, not a middle one.
  return new Set([...set].sort((a, b) => a - b))
}

export interface WordMark {
  text: string
  ok: boolean
}

export interface LiveWordMark {
  text: string
  ok: boolean
}

const normWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Fraction of words correct required to pass a passage line or full recall. */
export const PASSAGE_PASS_SCORE = 0.85

export type PassagePracticeKind = 'lines' | 'cumulative'

export interface PassagePracticeRound {
  kind: PassagePracticeKind
  coverage: number
  /** For cumulative rounds: how many lines from the start to practice together. */
  lineCount?: number
  title: string
}

/** Passages at least this many words long earn a full typed-recall capstone in Learn. */
export const FULL_RECALL_MIN_WORDS = 10

/**
 * Whether a Learn passage exercise should end with typing the full passage from
 * memory (live green/red word marks). Short cloze sentences stay blanks-only —
 * a typed capstone there costs time without adding real recall challenge.
 */
export function passageWantsFullRecall(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length >= FULL_RECALL_MIN_WORDS
}

/**
 * Graduated practice before full passage recite — several line-by-line passes with
 * rising blank coverage, then cumulative multi-line blanks when there are enough chunks.
 */
export function buildPassagePracticeRounds(
  baseCoverage: number,
  chunkCount: number,
  wantsFullRecall: boolean,
): PassagePracticeRound[] {
  const bc = Math.max(0.3, Math.min(1, baseCoverage))

  if (!wantsFullRecall) {
    return [{ kind: 'lines', coverage: bc, title: 'Recall' }]
  }

  if (chunkCount <= 1) {
    return [
      { kind: 'lines', coverage: Math.min(0.55, bc * 0.75), title: 'Warm-up' },
      { kind: 'lines', coverage: 1, title: 'Full line' },
    ]
  }

  const rounds: PassagePracticeRound[] = [
    { kind: 'lines', coverage: Math.min(0.5, bc * 0.7), title: 'Warm-up' },
    { kind: 'lines', coverage: Math.min(0.75, bc * 0.9), title: 'Build' },
    { kind: 'lines', coverage: 1, title: 'Each line' },
  ]

  if (chunkCount >= 4) {
    const mid = Math.ceil(chunkCount / 2)
    rounds.push({ kind: 'cumulative', coverage: 0.7, lineCount: mid, title: `Lines 1–${mid}` })
    rounds.push({ kind: 'cumulative', coverage: 0.85, lineCount: chunkCount, title: 'All lines' })
  } else {
    rounds.push({ kind: 'cumulative', coverage: 0.8, lineCount: chunkCount, title: 'All lines together' })
  }

  return rounds
}

/**
 * Live word marks while typing a full passage — complete words are green/red;
 * the word currently being typed turns green on a matching prefix, red when off track.
 */
export function livePassageMarks(expected: string, given: string): LiveWordMark[] {
  const expWords = expected.trim().split(/\s+/).filter(Boolean)
  if (!given.trim()) return []

  const trailingSpace = /\s$/.test(given)
  const tokens = given.trim().split(/\s+/).filter(Boolean)
  const marks: LiveWordMark[] = []

  const completeThrough = trailingSpace ? tokens.length : Math.max(0, tokens.length - 1)
  for (let i = 0; i < completeThrough; i++) {
    const exp = expWords[i] ?? ''
    const typed = tokens[i] ?? ''
    const ok = normWord(exp).length > 0 && normWord(exp) === normWord(typed)
    marks.push({ text: typed, ok })
  }

  if (!trailingSpace && tokens.length > 0) {
    const partial = tokens[tokens.length - 1] ?? ''
    const exp = expWords[completeThrough] ?? ''
    const expNorm = normWord(exp)
    const partNorm = normWord(partial)
    const ok =
      expNorm.length > 0 &&
      (partNorm.length === 0 || expNorm.startsWith(partNorm) || expNorm === partNorm)
    marks.push({ text: partial, ok })
  }

  return marks
}

/** Grade a typed chunk against the expected chunk, word by word (positional). */
export function gradePassageChunk(expected: string, given: string): { total: number; correct: number; marks: WordMark[] } {
  const expDisplay = expected.trim().split(/\s+/).filter(Boolean)
  const givWords = given.trim().split(/\s+/).map(normWord).filter(Boolean)
  let correct = 0
  const marks: WordMark[] = expDisplay.map((w, i) => {
    const ok = normWord(w).length > 0 && normWord(w) === (givWords[i] ?? '')
    if (ok) correct++
    return { text: w, ok }
  })
  return { total: expDisplay.length, correct, marks }
}
