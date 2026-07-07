import { Rating } from 'ts-fsrs'
import type { AnswerMode, AppState, Card, FamiliarityLevel, Grade, GradedAttempt, Note, Settings } from './types.ts'
import { blankIsWorthwhile, mcqIsWorthwhile } from './answer-modes.ts'
import { computeConcepts, weakCards } from './concepts.ts'
import type { ConceptStat } from './concepts.ts'
import { renderContent } from './schedule.ts'
import { cardState } from './schedule.ts'
import { clozeFullText } from './cloze.ts'
import { REQUEST_RETENTION, retrievability } from './fsrs.ts'
import type { SynthesisPartResult } from './unit-synthesis.ts'

// Learn mode — mastery learning in concept units with cumulative review.
//
//   Unit 1 → master · Unit 2 → master · Review(1+2) · Unit 3 → master · Review(1..3) · …
//
// Within a unit each card climbs a difficulty ladder that starts with RECOGNITION,
// not a passive flashcard: multiple choice → fill-blank (first-letter hint) →
// type from memory. Long "recite" passages (creeds, songs) that can't be typed or
// turned into choices fall back to self-rate. A card masters when it passes its
// top rung; a wrong graded answer drops it back one rung.
//
// Optimizations (expanded retrieval, interleaving, adaptive entry, FSRS bridge):
//   - Within-session spacing: re-queued cards wait N other cards before resurfacing.
//   - Adaptive ladder: prior graded attempts can skip easy rungs.
//   - Interleaved cumulative review: cards from all units shuffled together.
//   - FSRS-informed review rungs: retrievability sets starting difficulty.
//   - Optional pre-test: one typed attempt before the ladder for brand-new cards.
//   - Mastery events returned from answerLearn for FSRS graduation in the UI layer.

const GRADED_LADDER: AnswerMode[] = ['mcq', 'blank', 'typed']
export const LADDER_LABELS: Record<AnswerMode, string> = {
  mcq: 'Choices',
  blank: 'Fill blank',
  typed: 'Type',
  passage: 'Recite',
  'passage-full': 'Recite',
  self: 'Recite',
}

/** Answers longer than this can't reasonably be typed/MCQ'd → self-rate recite. */
const MAX_TYPE_LEN = 40

const ACCURACY_SKIP = 0.8
const MIN_ATTEMPTS_SKIP = 2
/** Per-card mastery in a session — remaining cards start on harder rungs. */
const MASTERY_RAMP = 0.08
/** Correct rung advance (not yet mastered) — gentle session-wide ramp. */
const RUNG_PASS_RAMP = 0.03
/** Adaptive tab: raise blank coverage after correct answers. */
const COVERAGE_PASS_RAMP = 0.06
/** Adaptive tab: lower blank coverage after misses. */
const COVERAGE_FAIL_DROP = 0.08
/** Adaptive tab: extra coverage bump when a card masters. */
const MASTERY_COVERAGE_RAMP = 0.1

/** Manual = you set coverage & ladder options; adaptive = performance drives difficulty + coverage. */
export type LearnTabMode = 'manual' | 'adaptive'

export const FAMILIARITY_OPTIONS: { id: FamiliarityLevel; label: string; hint: string }[] = [
  { id: 'new', label: 'Brand new', hint: 'Multiple choice first — the easiest on-ramp' },
  { id: 'some', label: 'Seen before', hint: 'Starts at choices; skips easy rungs if you already know them from Quiz/Review' },
  { id: 'comfortable', label: 'Somewhat familiar', hint: 'Skip recognition — start with fill-in-the-blank' },
  { id: 'know', label: 'Know it well', hint: 'Jump straight to typing from memory' },
]

export const FAMILIARITY_LABELS: Record<FamiliarityLevel, string> = {
  new: 'Brand new',
  some: 'Seen before',
  comfortable: 'Somewhat familiar',
  know: 'Know it well',
}

/** Base difficulty bias (0..1) from self-reported familiarity. */
export function familiarityBaseBias(f: FamiliarityLevel): number {
  switch (f) {
    case 'new':
      return 0
    case 'some':
      return 0.15
    case 'comfortable':
      return 0.45
    case 'know':
      return 0.75
  }
}

/**
 * Starting ladder index from self-reported familiarity — uses actual rung modes,
 * not a scaled float (which collapsed "seen before" into the same rung as "brand new").
 */
export function familiarityStartRung(f: FamiliarityLevel, ladder: AnswerMode[]): number {
  const top = Math.max(0, ladder.length - 1)
  const at = (mode: AnswerMode): number | null => {
    const i = ladder.indexOf(mode)
    return i >= 0 ? i : null
  }

  switch (f) {
    case 'new':
      return at('mcq') ?? 0
    case 'some':
      return at('mcq') ?? at('blank') ?? 0
    case 'comfortable': {
      const blank = at('blank')
      if (blank != null) return blank
      const typed = at('typed')
      return typed ?? top
    }
    case 'know':
      return at('typed') ?? top
  }
}

export interface LearnOptions {
  /** Minimum cards to show before a re-queued card resurfaces (expanded retrieval). */
  spacingGap: number
  /** Shuffle cumulative-review cards across units. */
  interleave: boolean
  /** One typed attempt before the ladder for cards with no prior attempts. */
  pretest: boolean
  /** Skip rungs when prior learn/review/quiz attempts show mastery. */
  adaptiveLadder: boolean
  /** Set cumulative-review starting rung from FSRS retrievability. */
  fsrsReviewRungs: boolean
  /** Deterministic shuffle seed (set at session start). */
  seed: number
  /** Self-reported familiarity — sets initial difficulty (per session). */
  familiarity?: FamiliarityLevel
  /**
   * Drill-in: consecutive top-rung passes required to master a card (default 1).
   * Weak-area drills use 2 — prove the hardest mode twice, spaced apart.
   */
  masteryStreak?: number
}

export const DEFAULT_LEARN_OPTIONS: LearnOptions = {
  spacingGap: 2,
  interleave: true,
  pretest: false,
  adaptiveLadder: true,
  fsrsReviewRungs: true,
  seed: 1,
}

/** Build learn options from app settings (with overrides for tests). */
export function learnOptionsFromSettings(settings: Settings, overrides?: Partial<LearnOptions>): LearnOptions {
  return {
    spacingGap: settings.learnSpacingGap ?? DEFAULT_LEARN_OPTIONS.spacingGap,
    interleave: settings.learnInterleave ?? DEFAULT_LEARN_OPTIONS.interleave,
    pretest: settings.learnPretest ?? DEFAULT_LEARN_OPTIONS.pretest,
    adaptiveLadder: settings.learnAdaptiveLadder ?? DEFAULT_LEARN_OPTIONS.adaptiveLadder,
    fsrsReviewRungs: settings.learnFsrsReviewRungs ?? DEFAULT_LEARN_OPTIONS.fsrsReviewRungs,
    seed: overrides?.seed ?? Date.now(),
    ...overrides,
  }
}

/** Source text of a card's passage-recall exercise (cloze: full text, markers stripped). */
export function passageSourceText(note: Note, card: Card): string {
  if (note.type === 'cloze') return clozeFullText(note.fields.text ?? '')
  return renderContent(note, card).answer
}

/** Case/whitespace-insensitive identity of a passage exercise. */
export function passageKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The rungs a specific card climbs, adapting to its answer. */
export function cardLadder(state: AppState, card: Card, note: Note): AnswerMode[] {
  if (note.type === 'cloze') return ['passage']
  const { question, answer: ansRaw } = renderContent(note, card)
  const ans = ansRaw.trim()
  if (ans.length === 0) return ['self']
  if (ans.length > MAX_TYPE_LEN) return ['passage']
  return GRADED_LADDER.filter((m) => {
    if (m === 'mcq') return mcqIsWorthwhile(state, card, note, question, ans)
    if (m === 'blank') return blankIsWorthwhile(ans)
    return true
  })
}

/** Progressive blank coverage: easier rungs reveal more of the answer. */
export function blankCoverageForRung(rung: number, ladder: AnswerMode[], base: number): number {
  const blankIdx = ladder.indexOf('blank')
  if (blankIdx < 0) return base
  const top = ladder.length - 1
  if (top <= blankIdx) return base
  const t = Math.max(0, Math.min(1, (rung - blankIdx) / (top - blankIdx)))
  const easy = Math.min(base, 0.35)
  return easy + t * (base - easy)
}

/**
 * Blank coverage for the current card.
 * Manual tab: fixed user setting. Adaptive tab: rung ramp + session coverageBias from performance.
 */
export function learnBlankCoverage(
  session: LearnSession,
  rung: number,
  ladder: AnswerMode[],
  baseCoverage: number,
): number {
  if ((session.tabMode ?? 'manual') === 'manual') return baseCoverage
  const rungBased = blankCoverageForRung(rung, ladder, baseCoverage)
  const bias = session.coverageBias ?? 0.5
  const shift = (bias - 0.5) * 0.5
  return Math.max(0.15, Math.min(0.95, rungBased + shift))
}

function accuracyForMode(attempts: GradedAttempt[], cardId: string, mode: AnswerMode): { n: number; acc: number } {
  const rel = attempts.filter((a) => a.cardId === cardId && a.mode === mode)
  const n = rel.length
  const acc = n ? rel.filter((a) => a.correct).length / n : 0
  return { n, acc }
}

/** Starting rung from prior graded attempts (0 = easiest rung on this ladder). */
export function startRungFromHistory(state: AppState, cardId: string, ladder: AnswerMode[]): number {
  const attempts = state.attempts
  const idx = (mode: AnswerMode) => ladder.indexOf(mode)

  const typed = idx('typed')
  if (typed >= 0) {
    const { n, acc } = accuracyForMode(attempts, cardId, 'typed')
    if (n >= MIN_ATTEMPTS_SKIP && acc >= ACCURACY_SKIP) return typed
  }
  const blank = idx('blank')
  if (blank >= 0) {
    const { n, acc } = accuracyForMode(attempts, cardId, 'blank')
    if (n >= MIN_ATTEMPTS_SKIP && acc >= ACCURACY_SKIP) return blank
  }
  const mcq = idx('mcq')
  if (mcq >= 0) {
    const { n, acc } = accuracyForMode(attempts, cardId, 'mcq')
    if (n >= MIN_ATTEMPTS_SKIP && acc >= ACCURACY_SKIP) return mcq
  }
  return 0
}

/** Recency half-life for graded-attempt evidence: last week's answers outweigh last month's. */
const KNOWLEDGE_HALF_LIFE_DAYS = 14
/** Minimum recency-weighted attempt count before accuracy is trusted on its own. */
const KNOWLEDGE_MIN_EVIDENCE = 0.75

export interface CardKnowledge {
  /** Any graded attempt or review event exists for this card. */
  seen: boolean
  /** Recency-weighted graded-attempt count (an attempt today weighs 1, fading with age). */
  evidence: number
  /** Recency-weighted graded accuracy (0 when no attempts). */
  accuracy: number
  /** FSRS recall probability right now, when the card has review events. */
  retrievability: number | null
}

/**
 * What the data says this card's owner knows — recency-weighted graded attempts
 * blended with the FSRS memory model. This is the per-card ground truth that
 * adaptive sessions start from (self-reported familiarity only covers cards
 * with no data at all).
 */
export function cardKnowledge(state: AppState, cardId: string, at = new Date()): CardKnowledge {
  let evidence = 0
  let weightedCorrect = 0
  for (const a of state.attempts) {
    if (a.cardId !== cardId) continue
    const days = Math.max(0, (at.getTime() - Date.parse(a.answeredAt)) / MS_PER_DAY)
    const w = Math.pow(0.5, days / KNOWLEDGE_HALF_LIFE_DAYS)
    evidence += w
    if (a.correct) weightedCorrect += w
  }
  const hasEvents = state.events.some((e) => e.cardId === cardId)
  const r = hasEvents ? retrievability(cardState(state, cardId), at) : null
  return {
    seen: evidence > 0 || hasEvents,
    evidence,
    accuracy: evidence > 0 ? weightedCorrect / evidence : 0,
    retrievability: r,
  }
}

/**
 * Starting rung from per-card data, or null when the card is unseen (caller
 * falls back to self-reported familiarity). Strong knowledge starts at free
 * recall; middling at fill-blank; weak/stale at the easiest rung.
 */
export function knowledgeStartRung(k: CardKnowledge, ladder: AnswerMode[]): number | null {
  const top = Math.max(0, ladder.length - 1)
  if (!k.seen) return null
  if (top === 0) return 0
  // Stale/thin attempt evidence keeps its accuracy signal but is discounted —
  // perfect answers from weeks ago earn a middle start, not free recall.
  const acc =
    k.evidence > 0 ? (k.evidence >= KNOWLEDGE_MIN_EVIDENCE ? k.accuracy : k.accuracy * 0.75) : null
  const r = k.retrievability
  const score = acc != null && r != null ? 0.5 * acc + 0.5 * r : (acc ?? r ?? 0)
  if (score >= 0.85) return top
  if (score >= 0.6) {
    const blank = ladder.indexOf('blank')
    return blank >= 0 ? blank : Math.max(0, top - 1)
  }
  return 0
}

/** Cumulative-review starting rung from FSRS retrievability. */
export function reviewRungFromFsrs(state: AppState, cardId: string, ladder: AnswerMode[], at = new Date()): number {
  const top = Math.max(0, ladder.length - 1)
  if (top === 0) return 0
  const fsrs = cardState(state, cardId)
  const r = retrievability(fsrs, at)
  if (r > 0.9) return top
  if (r > 0.7) return Math.max(0, top - 1)
  return 0
}

/**
 * Starting rung from familiarity, in-session mastery ramp, and optional attempt history.
 * Higher rung = harder question (closer to free recall).
 */
export function adaptiveStartRung(
  state: AppState,
  cardId: string,
  ladder: AnswerMode[],
  phase: Phase,
  session: LearnSession,
): number {
  const top = Math.max(0, ladder.length - 1)
  if (top === 0) return 0

  if (phase.kind === 'review' && session.opts.fsrsReviewRungs) {
    return reviewRungFromFsrs(state, cardId, ladder)
  }
  if (phase.kind === 'review') return top

  if ((session.tabMode ?? 'manual') === 'manual') {
    if (session.opts.adaptiveLadder) return startRungFromHistory(state, cardId, ladder)
    return 0
  }

  // Per-card data first: a card's own attempt history + FSRS state beats the
  // session-wide familiarity answer (which now only describes unseen cards).
  const dataRung = knowledgeStartRung(cardKnowledge(state, cardId), ladder)
  if (dataRung != null) return dataRung

  // Unseen card: start from self-reported familiarity, lifted by the session
  // mastery ramp (as you master cards, later NEW cards start slightly higher).
  let rung = familiarityStartRung(session.familiarity, ladder)
  const ramp = Math.round(session.difficultyBias * 0.55 * top)
  rung = Math.min(top, rung + ramp)
  return rung
}

function hasPriorAttempts(state: AppState, cardId: string): boolean {
  return state.attempts.some((a) => a.cardId === cardId)
}

/** True when any graded attempt or review event exists for this card. */
export function cardSeen(state: AppState, cardId: string): boolean {
  return hasPriorAttempts(state, cardId) || state.events.some((e) => e.cardId === cardId)
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export interface Unit {
  key: string
  label: string
  cardIds: string[]
}

/** Group cards into units: by first concept tag (fallback: deck), or fixed chunks. */
export function buildUnits(state: AppState, cardIds: string[], opts?: { byConcept?: boolean; size?: number }): Unit[] {
  const byConcept = opts?.byConcept ?? true
  const size = Math.max(1, opts?.size ?? 6)
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const cardsById = new Map(state.cards.map((c) => [c.id, c]))
  const deckName = new Map(state.decks.map((d) => [d.id, d.name]))

  const chunk = (ids: string[]): Unit[] => {
    const units: Unit[] = []
    for (let i = 0; i < ids.length; i += size) {
      units.push({ key: `unit-${units.length + 1}`, label: `Unit ${units.length + 1}`, cardIds: ids.slice(i, i + size) })
    }
    return units
  }

  if (!byConcept) return chunk(cardIds)

  const groups = new Map<string, string[]>()
  const order: string[] = []
  for (const id of cardIds) {
    const card = cardsById.get(id)
    if (!card) continue
    const note = notesById.get(card.noteId)
    const key = note && note.tags.length > 0 ? note.tags[0] : `deck:${card.deckId}`
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(id)
  }
  if (order.length <= 1) return chunk(cardIds)
  return order.map((key) => ({
    key,
    label: key.startsWith('deck:') ? deckName.get(key.slice(5)) ?? 'Cards' : key,
    cardIds: groups.get(key)!,
  }))
}

export interface WeakUnitCandidate {
  stat: ConceptStat
  unit: Unit
}

/**
 * Weak-area targeting: concepts (tags, deck-fallback) whose graded-answer
 * accuracy is below `maxAccuracy` with at least `minAttempts` answers, weakest
 * first. Each becomes a drill unit of that concept's cards ordered weakest
 * first (cards never attempted rank as slightly weak — unknown ≠ known), capped
 * to a focused drill size.
 */
export function weakUnitCandidates(
  state: AppState,
  scopeCardIds: string[],
  opts?: { minAttempts?: number; maxAccuracy?: number; maxUnits?: number; maxCardsPerUnit?: number },
): WeakUnitCandidate[] {
  const minAttempts = opts?.minAttempts ?? 3
  const maxAccuracy = opts?.maxAccuracy ?? 0.85
  const maxUnits = opts?.maxUnits ?? 3
  const maxCards = opts?.maxCardsPerUnit ?? 8
  const scope = new Set(scopeCardIds)
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const weakness = new Map(weakCards(state).map((w) => [w.cardId, w]))
  // Unattempted cards in a weak concept rank as slightly weak (0.9): they come
  // after genuinely-missed cards but before cards already answered perfectly.
  const rank = (id: string) => weakness.get(id)?.accuracy ?? 0.9

  const stats = computeConcepts(state, { minAttempts }).filter((c) => c.accuracy < maxAccuracy)
  const out: WeakUnitCandidate[] = []
  for (const stat of stats) {
    if (out.length >= maxUnits) break
    const cardIds = state.cards
      .filter((c) => {
        if (!scope.has(c.id)) return false
        const tags = notesById.get(c.noteId)?.tags ?? []
        return stat.kind === 'tag' ? tags.includes(stat.label) : c.deckId === stat.key.slice(5) && tags.length === 0
      })
      .map((c) => c.id)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, maxCards)
    if (cardIds.length === 0) continue
    out.push({ stat, unit: { key: `weak:${stat.key}`, label: stat.label, cardIds } })
  }
  return out
}

export interface StudyNowPlan {
  /** Ordered units: Refresh (fading memories) → Weak areas → New material. */
  units: Unit[]
  due: number
  weak: number
  fresh: number
  total: number
}

/** New-material slots always kept open so a review backlog can't stall learning. */
const STUDY_NOW_NEW_RESERVE = 3
const STUDY_NOW_DEFAULT_CARDS = 15
const STUDY_NOW_WEAK_ACCURACY = 0.85

/**
 * One-click session plan across the whole collection — no deck or unit picking.
 * Priority: cards whose FSRS recall probability fell below the retention target
 * (weakest memories first), then seen-but-shaky cards, then unseen cards capped
 * at maxNew with a few slots reserved whenever new material exists.
 */
export function buildStudyNow(
  state: AppState,
  opts?: { maxCards?: number; maxNew?: number; at?: Date },
): StudyNowPlan {
  const at = opts?.at ?? new Date()
  const cap = Math.max(1, opts?.maxCards ?? state.settings.studyNowCards ?? STUDY_NOW_DEFAULT_CARDS)
  // New material may fill whatever capacity fading/weak cards leave, bounded by
  // the existing new-cards-per-day concept — so a brand-new collection still
  // honors the session-size choice instead of stalling at a tiny fixed cap.
  const maxNew = Math.max(0, opts?.maxNew ?? Math.min(cap, state.settings.newPerDay ?? 20))
  // Same threshold the scheduler derives due dates from (NOT settings.desiredRetention,
  // which is not wired into the scheduler) — keeps Refresh aligned with Review.
  const desired = REQUEST_RETENTION

  const due: { id: string; r: number }[] = []
  const freshIds: string[] = []
  const seenIds = new Set<string>()
  for (const c of state.cards) {
    const k = cardKnowledge(state, c.id, at)
    if (!k.seen) {
      freshIds.push(c.id)
      continue
    }
    seenIds.add(c.id)
    if (k.retrievability != null && k.retrievability < desired) due.push({ id: c.id, r: k.retrievability })
  }
  due.sort((a, b) => a.r - b.r)

  const dueSet = new Set(due.map((d) => d.id))
  const weakRanked = weakCards(state).filter(
    (w) => seenIds.has(w.cardId) && !dueSet.has(w.cardId) && w.accuracy < STUDY_NOW_WEAK_ACCURACY,
  )

  const reserveNew = Math.min(STUDY_NOW_NEW_RESERVE, maxNew, freshIds.length)
  const dueTake = Math.min(due.length, Math.max(0, cap - reserveNew))
  const weakTake = Math.min(weakRanked.length, Math.max(0, cap - dueTake - reserveNew))
  const newTake = Math.min(freshIds.length, maxNew, Math.max(0, cap - dueTake - weakTake))

  const units: Unit[] = []
  if (dueTake > 0) units.push({ key: 'study-due', label: 'Refresh', cardIds: due.slice(0, dueTake).map((d) => d.id) })
  if (weakTake > 0)
    units.push({ key: 'study-weak', label: 'Weak areas', cardIds: weakRanked.slice(0, weakTake).map((w) => w.cardId) })
  if (newTake > 0) units.push({ key: 'study-new', label: 'New material', cardIds: freshIds.slice(0, newTake) })
  return { units, due: dueTake, weak: weakTake, fresh: newTake, total: dueTake + weakTake + newTake }
}

export type Phase =
  | { kind: 'learn'; unit: number }
  | { kind: 'synthesis'; unit: number }
  | { kind: 'review'; upTo: number }

/**
 * learn → synthesis (multi-card units) → … cumulative review after each new unit past the first.
 * Weak-area drills use a single interleaved learn phase (no per-topic synthesis).
 */
export function buildPhases(units: Unit[], enableSynthesis = true, focus?: 'weak' | 'study'): Phase[] {
  if (focus === 'weak' && units.length > 0) {
    return [{ kind: 'learn', unit: 0 }]
  }
  const phases: Phase[] = []
  for (let i = 0; i < units.length; i++) {
    phases.push({ kind: 'learn', unit: i })
    if (enableSynthesis && units[i].cardIds.length >= 2) {
      phases.push({ kind: 'synthesis', unit: i })
    }
    if (i >= 1) phases.push({ kind: 'review', upTo: i })
  }
  return phases
}

export interface LearnItem {
  cardId: string
  rung: number
  /** Brand-new card: one generation-effect attempt before the ladder. */
  pretest?: boolean
  /** Don't surface until session.seen reaches this value. */
  readyAt?: number
  /** Consecutive top-rung passes so far (drill-in streak; reset by a top-rung miss). */
  topPasses?: number
}

export interface LearnSession {
  units: Unit[]
  phases: Phase[]
  ladders: Record<string, AnswerMode[]>
  opts: LearnOptions
  phaseIndex: number
  queue: LearnItem[]
  /** Spaced re-queues waiting for expanded-retrieval gap. */
  waiting: LearnItem[]
  /** Cards skipped during normal phases — replayed in a catch-up round at session end. */
  deferred: LearnItem[]
  /** Consecutive graded failures per card (widens spacing gap). */
  failStreak: Record<string, number>
  catchUp: boolean
  done: boolean
  attempts: number
  correct: number
  masteredCount: number
  totalToMaster: number
  seen: number
  /** Cards that mastered in learn/catch-up this session (for FSRS highlight). */
  graduatedCardIds: string[]
  /** Manual vs adaptive learn tab that started this session. */
  tabMode: LearnTabMode
  /** Self-reported familiarity at session start (adaptive tab). */
  familiarity: FamiliarityLevel
  /** 0..1 — rises as you master cards; lifts starting rung for later units (adaptive). */
  difficultyBias: number
  /** 0..1 — adaptive tab: rises with correct answers, drops on misses; shifts blank coverage. */
  coverageBias: number
  /** Drilling missed sections before retrying a full-unit synthesis test. */
  synthesisRemediate?: { unit: number; cardIds: string[] }
  /** How many times the full-unit test has been attempted (for retry label). */
  synthesisAttempt?: number
  /** Session origin: weak-area drill (labels/summary/single-phase) or one-click
   * Study now (priority-bucket units — no synthesis test, no familiarity badge). */
  focus?: 'weak' | 'study'
  /**
   * Passage twins collapsed at session start: representative cardId → sibling
   * cardIds whose exercise is the same full-text reconstruction (cloze siblings
   * of one note, plus recite cards with the same answer). Peers never enter the
   * queue; mastering the representative credits them all.
   */
  passagePeers?: Record<string, string[]>
}

export interface PersistedLearn {
  session: LearnSession
  savedAt: string
  deckId: string
  unitKeys: string[]
}

const MS_PER_DAY = 86_400_000
const HIGHLIGHT_TTL_MS = MS_PER_DAY

/** FSRS rating when a card masters in learn mode. */
export function learnMasteryRating(mode: AnswerMode): Grade {
  if (mode === 'mcq') return Rating.Hard
  return Rating.Good
}

/** Whether learn mastery should append a ReviewEvent. */
export function shouldGraduateLearnMastery(
  state: AppState,
  cardId: string,
  phase: 'learn' | 'review' | 'catchup',
  mode: AnswerMode,
): boolean {
  if (state.settings.learnGraduateFsrs === false) return false
  // Self-rated rungs already record their own review() with the user's true
  // rating (Good or Again) — graduating here would double-log the same recall,
  // and could log Good on top of a failed self-rate (self always advances).
  if (mode === 'self') return false
  const existing = state.events.filter((e) => e.cardId === cardId)
  if (existing.length > 0 && phase === 'review') return false
  return phase === 'learn' || phase === 'catchup'
}

/** Drop rungs on in-progress items after whole days away (distributed practice). */
export function decayLearnSession(session: LearnSession, savedAt: string, at = new Date()): LearnSession {
  const base = {
    tabMode: session.tabMode ?? 'manual',
    familiarity: session.familiarity ?? 'some',
    difficultyBias: session.difficultyBias ?? 0,
    coverageBias: session.coverageBias ?? 0.5,
  }
  const days = Math.floor((at.getTime() - Date.parse(savedAt)) / MS_PER_DAY)
  if (days <= 0 || session.done) return { ...session, ...base }
  const drop = (item: LearnItem): LearnItem => ({
    ...item,
    pretest: undefined,
    topPasses: undefined, // days away → re-prove the drill streak from scratch
    rung: Math.max(0, item.rung - days),
  })
  return {
    ...session,
    ...base,
    queue: session.queue.map(drop),
    waiting: session.waiting.map(drop),
    deferred: session.deferred.map(drop),
    done: false,
  }
}

export function isLearnResumable(p: PersistedLearn | null | undefined): p is PersistedLearn {
  if (!p || p.session.done) return false
  const phase = p.session.phases[p.session.phaseIndex]
  const awaitingSynthesis =
    phase?.kind === 'synthesis' && !p.session.synthesisRemediate && p.session.queue.length === 0
  return (
    p.session.queue.length > 0 ||
    p.session.waiting.length > 0 ||
    p.session.deferred.length > 0 ||
    awaitingSynthesis
  )
}

export function isSynthesisPhase(session: LearnSession): boolean {
  const phase = session.phases[session.phaseIndex]
  return phase?.kind === 'synthesis' && !session.synthesisRemediate && session.queue.length === 0
}

/** Merge new graduates into a highlight list; prune entries older than 24h. */
export function mergeLearnHighlight(
  existing: { cardIds: string[]; setAt: string } | null | undefined,
  newIds: string[],
  at = new Date(),
): { cardIds: string[]; setAt: string } | null {
  if (newIds.length === 0 && !existing) return null
  const cutoff = at.getTime() - HIGHLIGHT_TTL_MS
  const fresh = existing && Date.parse(existing.setAt) >= cutoff ? existing.cardIds : []
  const merged = [...new Set([...fresh, ...newIds])]
  if (merged.length === 0) return null
  return { cardIds: merged, setAt: at.toISOString() }
}

export function isLearnHighlightActive(highlight: { setAt: string } | null | undefined, at = new Date()): boolean {
  if (!highlight) return false
  return at.getTime() - Date.parse(highlight.setAt) < HIGHLIGHT_TTL_MS
}

/** Cross-device LWW: keep the highlight with the newest setAt (if still within TTL). */
export function mergeLearnHighlightRemote(
  local: { cardIds: string[]; setAt: string } | null | undefined,
  remote: { cardIds: string[]; setAt: string } | null | undefined,
  at = new Date(),
): { cardIds: string[]; setAt: string } | null {
  const loc = local && isLearnHighlightActive(local, at) ? local : null
  const rem = remote && isLearnHighlightActive(remote, at) ? remote : null
  if (!loc) return rem
  if (!rem) return loc
  return Date.parse(rem.setAt) >= Date.parse(loc.setAt) ? rem : loc
}

export interface LearnMastery {
  cardId: string
  mode: AnswerMode
  phase: 'learn' | 'review' | 'catchup' | 'remediate'
  /** Collapsed passage twins that this mastery also graduates. */
  peerCardIds?: string[]
}

export interface LearnAnswerResult {
  session: LearnSession
  mastery: LearnMastery | null
}

function buildLearnItem(state: AppState, session: LearnSession, cardId: string, ladder: AnswerMode[], phase: Phase): LearnItem {
  const rung = adaptiveStartRung(state, cardId, ladder, phase, session)
  const adaptive = (session.tabMode ?? 'manual') === 'adaptive'
  const wantsPretest = adaptive ? session.familiarity === 'new' : session.opts.pretest
  const skipPretest = adaptive && (session.familiarity === 'know' || session.familiarity === 'comfortable')
  const pretest =
    phase.kind === 'learn' &&
    wantsPretest &&
    !skipPretest &&
    !cardSeen(state, cardId) &&
    ladder.includes('typed') &&
    rung === 0
  return { cardId, rung, pretest: pretest || undefined }
}

function remediationRung(ladder: AnswerMode[]): number {
  const blank = ladder.indexOf('blank')
  if (blank >= 0) return blank
  return Math.max(0, ladder.length - 1)
}

function remediationQueue(session: LearnSession, cardIds: string[]): LearnItem[] {
  return cardIds.map((cardId) => {
    const ladder = session.ladders[cardId] ?? ['self']
    return { cardId, rung: remediationRung(ladder) }
  })
}

function phaseQueue(state: AppState, session: LearnSession, phaseIndex: number): LearnItem[] {
  const phase = session.phases[phaseIndex]
  if (!phase) return []
  const opts = session.opts

  if (phase.kind === 'synthesis') return []

  if (phase.kind === 'learn') {
    let ids =
      session.focus === 'weak'
        ? session.units.flatMap((u) => u.cardIds)
        : session.units[phase.unit].cardIds
    if (session.focus === 'weak' && ids.length > 1) {
      ids = seededShuffle(ids, opts.seed)
    }
    return ids.map((cardId) => {
      const ladder = session.ladders[cardId] ?? ['self']
      return buildLearnItem(state, session, cardId, ladder, phase)
    })
  }

  let ids = session.units.slice(0, phase.upTo + 1).flatMap((u) => u.cardIds)
  if (opts.interleave && ids.length > 1) {
    ids = seededShuffle(ids, opts.seed + phaseIndex)
  }
  return ids.map((cardId) => {
    const ladder = session.ladders[cardId] ?? ['self']
    return buildLearnItem(state, session, cardId, ladder, phase)
  })
}

function promoteWaiting(session: LearnSession): LearnSession {
  let s = session
  // Queue idle but cards are spaced out — fast-forward to the next ready item.
  if (s.queue.length === 0 && s.waiting.length > 0) {
    const minReady = Math.min(...s.waiting.map((w) => w.readyAt ?? 0))
    if (minReady > s.seen) s = { ...s, seen: minReady }
  }
  const ready: LearnItem[] = []
  const still: LearnItem[] = []
  for (const item of s.waiting) {
    if ((item.readyAt ?? 0) <= s.seen) ready.push(item)
    else still.push(item)
  }
  if (ready.length === 0) return s
  return { ...s, queue: [...s.queue, ...ready], waiting: still }
}

function spacingGap(session: LearnSession, cardId: string, failed: boolean): number {
  const base = session.opts.spacingGap
  if (!failed) return base
  const streak = (session.failStreak[cardId] ?? 0) + 1
  return base + Math.min(streak, 3)
}

function requeue(session: LearnSession, item: LearnItem, failed: boolean, queueAfterPop: LearnItem[]): LearnSession {
  const othersRemain = queueAfterPop.length > 0 || session.waiting.length > 0
  const gap = othersRemain ? spacingGap(session, item.cardId, failed) : 0
  const failStreak = failed
    ? { ...session.failStreak, [item.cardId]: (session.failStreak[item.cardId] ?? 0) + 1 }
    : { ...session.failStreak, [item.cardId]: 0 }
  const waiting = [...session.waiting, { ...item, readyAt: session.seen + gap }]
  return { ...session, waiting, failStreak }
}

export function startLearnFromUnits(
  state: AppState,
  units: Unit[],
  opts?: Partial<LearnOptions> & { tabMode?: LearnTabMode; focus?: 'weak' | 'study' },
): LearnSession {
  const cardsById = new Map(state.cards.map((c) => [c.id, c]))
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const ladders: Record<string, AnswerMode[]> = {}
  for (const u of units) {
    for (const id of u.cardIds) {
      const card = cardsById.get(id)
      const note = card ? notesById.get(card.noteId) : undefined
      ladders[id] = card && note ? cardLadder(state, card, note) : ['self']
    }
  }

  // Collapse passage twins: cards whose only rung is the same full-text
  // reconstruction (a multi-deletion cloze note's siblings + a "Recite …" card
  // with the identical answer) are one exercise — repeating it N times per
  // session adds time, not challenge. One representative stays in the units;
  // mastering it credits every peer.
  const passagePeers: Record<string, string[]> = {}
  const repByKey = new Map<string, string>()
  const dropped = new Set<string>()
  for (const u of units) {
    for (const id of u.cardIds) {
      const ladder = ladders[id]
      if (!ladder || ladder.length !== 1 || ladder[0] !== 'passage') continue
      const card = cardsById.get(id)
      const note = card ? notesById.get(card.noteId) : undefined
      if (!card || !note) continue
      const key = passageKey(passageSourceText(note, card))
      if (!key) continue
      const rep = repByKey.get(key)
      if (rep === undefined) {
        repByKey.set(key, id)
        continue
      }
      const repNote = notesById.get(cardsById.get(rep)!.noteId)
      if (repNote?.type === 'cloze' && note.type !== 'cloze') {
        // A non-cloze rep presents better (its question is a real prompt, not a
        // cloze stem with [...]) — promote this card and demote the old rep.
        repByKey.set(key, id)
        dropped.add(rep)
        passagePeers[id] = [...(passagePeers[rep] ?? []), rep]
        delete passagePeers[rep]
      } else {
        dropped.add(id)
        passagePeers[rep] = [...(passagePeers[rep] ?? []), id]
      }
    }
  }
  if (dropped.size > 0) {
    units = units
      .map((u) => ({ ...u, cardIds: u.cardIds.filter((id) => !dropped.has(id)) }))
      .filter((u) => u.cardIds.length > 0)
  }
  const { tabMode: tabModeOpt, familiarity: familiarityOpt, focus, ...learnOptRest } = opts ?? {}
  const learnOpts = learnOptionsFromSettings(state.settings, learnOptRest)
  const tabMode = tabModeOpt ?? 'manual'
  const familiarity = tabMode === 'adaptive' ? (familiarityOpt ?? 'some') : 'some'
  // No full-unit synthesis test for weak drills or Study now: their units are
  // priority buckets (Refresh / Weak / New), not coherent topics worth a
  // whole-unit recall gate.
  const enableSynthesis = focus === 'weak' || focus === 'study' ? false : state.settings.learnUnitSynthesis !== false
  const session: LearnSession = {
    units,
    phases: buildPhases(units, enableSynthesis, focus),
    ladders,
    opts: learnOpts,
    phaseIndex: 0,
    queue: [],
    waiting: [],
    deferred: [],
    failStreak: {},
    catchUp: false,
    done: units.length === 0,
    attempts: 0,
    correct: 0,
    masteredCount: 0,
    totalToMaster: units.reduce((a, u) => a + u.cardIds.length, 0),
    seen: 0,
    graduatedCardIds: [],
    tabMode,
    familiarity,
    difficultyBias: 0,
    coverageBias: 0.5,
    focus,
    passagePeers: dropped.size > 0 ? passagePeers : undefined,
  }
  session.queue = phaseQueue(state, session, 0)
  return session
}

export function startLearn(
  state: AppState,
  cardIds: string[],
  opts?: { byConcept?: boolean; size?: number; tabMode?: LearnTabMode } & Partial<LearnOptions>,
): LearnSession {
  const { byConcept, size, ...learnOpts } = opts ?? {}
  return startLearnFromUnits(state, buildUnits(state, cardIds, { byConcept, size }), learnOpts)
}

export interface CurrentLearn {
  cardId: string
  mode: AnswerMode
  ladder: AnswerMode[]
  rung: number
  pretest: boolean
  /** Consecutive top-rung passes so far on this card (drill-in streak). */
  topPasses: number
  /** Top-rung passes required to master (1 = normal, 2 = weak-area drill). */
  masteryStreak: number
  /** Full-unit recall test after mastering individual cards in a topic. */
  unitSynthesis?: { unitIndex: number }
}

/** The card + answer mode to present right now (null when the session is done). */
export function currentLearn(session: LearnSession): CurrentLearn | null {
  const s = promoteWaiting(session)
  if (s.done) return null
  const streak = Math.max(1, s.opts.masteryStreak ?? 1)
  const phase = s.phases[s.phaseIndex]
  if (phase?.kind === 'synthesis' && !s.synthesisRemediate && s.queue.length === 0) {
    return {
      cardId: s.units[phase.unit].cardIds[0],
      mode: 'typed',
      ladder: [],
      rung: 0,
      pretest: false,
      topPasses: 0,
      masteryStreak: streak,
      unitSynthesis: { unitIndex: phase.unit },
    }
  }
  if (s.queue.length === 0) return null
  const item = s.queue[0]
  const ladder = s.ladders[item.cardId] ?? ['self']
  if (item.pretest) {
    return { cardId: item.cardId, mode: 'typed', ladder, rung: 0, pretest: true, topPasses: 0, masteryStreak: streak }
  }
  const rung = Math.min(item.rung, ladder.length - 1)
  return {
    cardId: item.cardId,
    mode: ladder[rung],
    ladder,
    rung,
    pretest: false,
    topPasses: item.topPasses ?? 0,
    masteryStreak: streak,
  }
}

/** Sync session queue after promoting spaced items (call before currentLearn in UI if needed). */
export function tickLearnQueue(session: LearnSession): LearnSession {
  return promoteWaiting(session)
}

export function phaseLabel(session: LearnSession): string {
  if (session.catchUp) return `Catch-up · ${session.queue.length} remaining`
  const p = session.phases[session.phaseIndex]
  if (!p) return ''
  if (p.kind === 'learn') {
    if (session.focus === 'weak') {
      const topics = session.units.map((u) => u.label).join(', ')
      return session.units.length > 1 ? `Weak drill · shuffled · ${topics}` : `Weak drill · ${topics}`
    }
    return `Unit ${p.unit + 1} of ${session.units.length}: ${session.units[p.unit].label}`
  }
  if (p.kind === 'synthesis') {
    if (session.synthesisRemediate) {
      return `Focus missed parts · ${session.units[p.unit].label} · ${session.queue.length} left`
    }
    const attempt = session.synthesisAttempt ?? 1
    return attempt > 1
      ? `Full review (retry) · ${session.units[p.unit].label}`
      : `Full review · ${session.units[p.unit].label}`
  }
  return `Cumulative review · units 1–${p.upTo + 1}`
}

function advanceWhenQueueEmpty(state: AppState, session: LearnSession): LearnSession {
  const phase = session.phases[session.phaseIndex]
  if (phase?.kind === 'synthesis') {
    if (session.synthesisRemediate && session.queue.length === 0 && session.waiting.length === 0) {
      return { ...session, synthesisRemediate: undefined }
    }
    return session
  }
  if (session.catchUp) return { ...session, done: true }
  const nextIndex = session.phaseIndex + 1
  if (nextIndex >= session.phases.length) {
    if (session.deferred.length > 0) {
      return { ...session, catchUp: true, queue: session.deferred, deferred: [], waiting: [] }
    }
    return { ...session, done: true, waiting: [] }
  }
  return { ...session, phaseIndex: nextIndex, queue: phaseQueue(state, session, nextIndex), waiting: [] }
}

/** Skip the current card — defer to end-of-session catch-up (or back of catch-up queue). No SRS/mastery impact. */
export function skipLearn(state: AppState, session: LearnSession): LearnSession {
  let s = promoteWaiting(session)
  if (s.done || s.queue.length === 0) return s
  const [cur, ...rest] = s.queue
  if (s.catchUp) return { ...s, queue: [...rest, cur] }
  let next: LearnSession = { ...s, queue: rest, deferred: [...s.deferred, cur] }
  if (next.queue.length === 0 && next.waiting.length === 0) next = advanceWhenQueueEmpty(state, next)
  return next
}

export function deferredLearnCount(session: LearnSession): number {
  return session.catchUp ? session.queue.length : session.deferred.length
}

export function waitingLearnCount(session: LearnSession): number {
  return session.waiting.length
}

function phaseKind(session: LearnSession): 'learn' | 'review' | 'catchup' | 'synthesis' | 'remediate' {
  if (session.catchUp) return 'catchup'
  const phase = session.phases[session.phaseIndex]
  if (phase?.kind === 'synthesis' && session.synthesisRemediate) return 'remediate'
  if (phase?.kind === 'synthesis') return 'synthesis'
  return phase?.kind === 'review' ? 'review' : 'learn'
}

/** Submit a full-unit synthesis test; failed sections queue for focused drill. */
export function answerUnitSynthesis(
  state: AppState,
  session: LearnSession,
  results: SynthesisPartResult[],
): LearnSession {
  let s = promoteWaiting(session)
  const phase = s.phases[s.phaseIndex]
  if (phase?.kind !== 'synthesis') return s

  const failed = results.filter((r) => !r.passed).map((r) => r.cardId)
  const attempt = failed.length > 0 ? (s.synthesisAttempt ?? 1) + 1 : undefined

  if (failed.length === 0) {
    const nextIndex = s.phaseIndex + 1
    if (nextIndex >= s.phases.length) {
      if (s.deferred.length > 0) {
        return { ...s, phaseIndex: nextIndex, synthesisRemediate: undefined, catchUp: true, queue: s.deferred, deferred: [], waiting: [] }
      }
      return { ...s, phaseIndex: nextIndex, synthesisRemediate: undefined, synthesisAttempt: undefined, done: true, waiting: [] }
    }
    return {
      ...s,
      phaseIndex: nextIndex,
      synthesisRemediate: undefined,
      synthesisAttempt: undefined,
      queue: phaseQueue(state, s, nextIndex),
      waiting: [],
      seen: s.seen + 1,
    }
  }

  return {
    ...s,
    synthesisRemediate: { unit: phase.unit, cardIds: failed },
    synthesisAttempt: attempt,
    queue: remediationQueue(s, failed),
    waiting: [],
    seen: s.seen + 1,
    attempts: s.attempts + results.length,
    correct: s.correct + results.filter((r) => r.passed).length,
  }
}

function isAdaptiveSession(session: LearnSession): boolean {
  return (session.tabMode ?? 'manual') === 'adaptive'
}

function nextCoverageBias(session: LearnSession, passed: boolean, mastered: boolean): number {
  if (!isAdaptiveSession(session)) return session.coverageBias ?? 0.5
  let b = session.coverageBias ?? 0.5
  if (mastered) b = Math.min(1, b + MASTERY_COVERAGE_RAMP)
  else if (passed) b = Math.min(1, b + COVERAGE_PASS_RAMP)
  else b = Math.max(0, b - COVERAGE_FAIL_DROP)
  return b
}

function nextDifficultyBias(session: LearnSession, delta: number): number {
  if (!isAdaptiveSession(session)) return session.difficultyBias
  return Math.min(1, session.difficultyBias + delta)
}

/** Advance after answering the current card. Handles rung movement + phase transitions. Pure. */
export function answerLearn(state: AppState, session: LearnSession, passed: boolean): LearnAnswerResult {
  let s = promoteWaiting(session)
  if (s.done || s.queue.length === 0) return { session: s, mastery: null }

  const [cur, ...rest] = s.queue
  const ladder = s.ladders[cur.cardId] ?? ['self']
  const phase = phaseKind(s)

  // Pre-test: always continue to ladder (generation effect); pass/fail only logged.
  if (cur.pretest) {
    const nextItem: LearnItem = { cardId: cur.cardId, rung: cur.rung }
    const requeued = requeue({ ...s, queue: rest, seen: s.seen + 1 }, nextItem, !passed, rest)
    let next = promoteWaiting(requeued)
    if (next.queue.length === 0 && next.waiting.length === 0) next = advanceWhenQueueEmpty(state, next)
    return { session: next, mastery: null }
  }

  const rungIdx = Math.min(cur.rung, ladder.length - 1)
  const mode = ladder[rungIdx]
  const isSelf = mode === 'self'
  const graded = !isSelf

  if (phase === 'remediate') {
    if (passed) {
      let next: LearnSession = {
        ...s,
        queue: rest,
        seen: s.seen + 1,
        attempts: s.attempts + (graded ? 1 : 0),
        correct: s.correct + (graded ? 1 : 0),
        failStreak: { ...s.failStreak, [cur.cardId]: 0 },
      }
      if (next.queue.length === 0 && next.waiting.length === 0) next = advanceWhenQueueEmpty(state, next)
      return { session: next, mastery: null }
    }
    const item: LearnItem = { cardId: cur.cardId, rung: cur.rung }
    const mid = { ...s, queue: rest, seen: s.seen + 1, coverageBias: nextCoverageBias(s, false, false) }
    let n = requeue(mid, item, true, rest)
    n = promoteWaiting(n)
    if (n.queue.length === 0 && n.waiting.length === 0) n = advanceWhenQueueEmpty(state, n)
    return { session: n, mastery: null }
  }

  let queue: LearnItem[]
  let masteredNow = false
  let mastery: LearnMastery | null = null

  if (isSelf || passed) {
    const nextRung = cur.rung + 1
    if (nextRung >= ladder.length) {
      // Top rung passed. Drill-in: with masteryStreak > 1 the card must pass the
      // top rung `streak` consecutive times (spaced apart) before it masters.
      const streakNeeded = Math.max(1, s.opts.masteryStreak ?? 1)
      const passes = (cur.topPasses ?? 0) + 1
      if (passes < streakNeeded) {
        const item: LearnItem = { cardId: cur.cardId, rung: cur.rung, topPasses: passes }
        const mid = {
          ...s,
          queue: rest,
          seen: s.seen + 1,
          attempts: s.attempts + (graded ? 1 : 0),
          correct: s.correct + (graded ? 1 : 0),
          difficultyBias: nextDifficultyBias(s, RUNG_PASS_RAMP),
          coverageBias: nextCoverageBias(s, true, false),
          failStreak: { ...s.failStreak, [cur.cardId]: 0 },
        }
        let n = requeue(mid, item, false, rest)
        n = promoteWaiting(n)
        if (n.queue.length === 0 && n.waiting.length === 0) n = advanceWhenQueueEmpty(state, n)
        return { session: n, mastery: null }
      }
      queue = rest
      masteredNow = true
      const peers = s.passagePeers?.[cur.cardId]
      mastery = {
        cardId: cur.cardId,
        mode,
        phase: phase === 'synthesis' ? 'learn' : phase,
        peerCardIds: peers && peers.length > 0 ? peers : undefined,
      }
    } else {
      const item: LearnItem = { cardId: cur.cardId, rung: nextRung }
      const mid = {
        ...s,
        queue: rest,
        seen: s.seen + 1,
        difficultyBias: nextDifficultyBias(s, RUNG_PASS_RAMP),
        coverageBias: nextCoverageBias(s, true, false),
      }
      let n = requeue(mid, item, false, rest)
      n = promoteWaiting(n)
      if (n.queue.length === 0 && n.waiting.length === 0) n = advanceWhenQueueEmpty(state, n)
      return { session: n, mastery: null }
    }
  } else {
    // Miss: drop a rung and reset the drill streak — "drilled in" means
    // consecutive proof, not accumulated passes.
    const item: LearnItem = { cardId: cur.cardId, rung: Math.max(0, cur.rung - 1), topPasses: undefined }
    const mid = { ...s, queue: rest, seen: s.seen + 1, coverageBias: nextCoverageBias(s, false, false) }
    let n = requeue(mid, item, true, rest)
    n = promoteWaiting(n)
    if (n.queue.length === 0 && n.waiting.length === 0) n = advanceWhenQueueEmpty(state, n)
    return { session: n, mastery: null }
  }

  const inLearnPhase = s.phases[s.phaseIndex]?.kind === 'learn'
  const countsMastery = masteredNow && (inLearnPhase || s.catchUp)
  const countsGraduate = masteredNow && (phase === 'learn' || phase === 'catchup')
  let next: LearnSession = {
    ...s,
    queue,
    seen: s.seen + 1,
    attempts: s.attempts + (graded ? 1 : 0),
    correct: s.correct + (graded && passed ? 1 : 0),
    masteredCount: s.masteredCount + (countsMastery ? 1 : 0),
    graduatedCardIds: countsGraduate
      ? [...new Set([...s.graduatedCardIds, cur.cardId, ...(s.passagePeers?.[cur.cardId] ?? [])])]
      : s.graduatedCardIds,
    difficultyBias: countsMastery ? nextDifficultyBias(s, MASTERY_RAMP) : s.difficultyBias,
    coverageBias: nextCoverageBias(s, true, countsMastery),
    failStreak: { ...s.failStreak, [cur.cardId]: 0 },
  }

  if (next.queue.length === 0 && next.waiting.length === 0) next = advanceWhenQueueEmpty(state, next)
  return { session: next, mastery }
}