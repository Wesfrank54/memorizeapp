import type { AppState, Card, Commitment, Note, ReviewEvent } from './types.ts'
import { clozeAnswer } from './cloze.ts'

// Phase 4 — the accountability layer (the product differentiator).
//
// Two principles from the research:
//   1. Progress is measured, never self-reported. Daily commitments read the
//      event log; retention commitments resolve against *proctored recall
//      checkpoints* — stakes tied to verified recall, which nobody else does.
//   2. Healthy by construction: opt-in, a hard stake cap, streaks that forgive a
//      miss, and forfeits routed to charity (never company revenue). Demo only —
//      no real money moves.

/** Hard cap on a single (demo) stake: $50. */
export const STAKE_CAP_CENTS = 5000
/** Default number of cards a recall checkpoint samples. */
export const CHECKPOINT_SIZE = 10
/** Earn one streak freeze per this many active days. */
const FREEZE_EARN_DAYS = 7

// ---- date helpers (local-day buckets) -------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function reviewsByDay(events: ReviewEvent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of events) {
    const k = dayKey(new Date(e.reviewedAt))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}

// ---- streaks with forgiveness ---------------------------------------------

export interface StreakInfo {
  current: number
  freezesAvailable: number
  reviewedToday: boolean
}

/** Consecutive review days up to today; an earned freeze can absorb one gap day. */
export function computeStreak(events: ReviewEvent[], now: Date): StreakInfo {
  const counts = reviewsByDay(events)
  const activeDays = counts.size
  const earnedFreezes = Math.floor(activeDays / FREEZE_EARN_DAYS)

  const today = startOfDay(now)
  const reviewedToday = (counts.get(dayKey(today)) ?? 0) > 0

  let freezes = earnedFreezes
  let streak = 0
  // Today still in progress: if not reviewed yet, start counting from yesterday.
  let cursor = reviewedToday ? today : addDays(today, -1)
  while (true) {
    if ((counts.get(dayKey(cursor)) ?? 0) > 0) {
      streak++
      cursor = addDays(cursor, -1)
    } else if (freezes > 0) {
      freezes-- // a freeze absorbs the gap; the streak survives
      cursor = addDays(cursor, -1)
    } else {
      break
    }
  }
  return { current: streak, freezesAvailable: earnedFreezes, reviewedToday }
}

// ---- commitment evaluation ------------------------------------------------

export interface CommitmentEval {
  /** Live status: 'active' = still in play. */
  status: 'active' | 'met' | 'failed'
  headline: string
  detail: string
  progressPct: number
  todayRemaining?: number
  bufferDays?: number
  verifiedRetention?: number | null
}

function evalDailyReviews(state: AppState, c: Commitment, now: Date): CommitmentEval {
  const counts = reviewsByDay(state.events)
  const target = c.dailyTarget ?? 1
  const grace = c.graceDays ?? 1
  const start = startOfDay(new Date(c.startDate))
  const deadline = startOfDay(new Date(c.deadline))
  const today = startOfDay(now)

  let misses = 0
  let totalDays = 0
  let metDays = 0
  for (let d = new Date(start); d < deadline; d = addDays(d, 1)) {
    totalDays++
    if (d < today) {
      if ((counts.get(dayKey(d)) ?? 0) >= target) metDays++
      else misses++
    }
  }
  const todayInRange = today >= start && today < deadline
  const todayGot = todayInRange ? counts.get(dayKey(today)) ?? 0 : 0
  const todayRemaining = Math.max(0, target - todayGot)
  const bufferDays = grace - misses
  const progressPct = totalDays === 0 ? 1 : Math.min(1, (metDays + (todayRemaining === 0 && todayInRange ? 1 : 0)) / totalDays)

  if (misses > grace) {
    return { status: 'failed', headline: 'Derailed', detail: `Missed ${misses} days (grace ${grace}).`, progressPct, bufferDays }
  }
  if (today >= deadline) {
    return { status: 'met', headline: 'Met', detail: `Kept the habit to the deadline.`, progressPct: 1, bufferDays }
  }
  const headline = todayRemaining === 0 ? 'On track — done today' : 'At risk today'
  const detail =
    todayRemaining === 0
      ? `${bufferDays} grace day${bufferDays === 1 ? '' : 's'} left.`
      : `Review ${todayRemaining} more today. ${bufferDays} grace day${bufferDays === 1 ? '' : 's'} left.`
  return { status: 'active', headline, detail, progressPct, todayRemaining, bufferDays }
}

function evalRetentionGoal(state: AppState, c: Commitment, now: Date): CommitmentEval {
  const target = c.targetRetention ?? 0.85
  const minCards = c.minCards ?? CHECKPOINT_SIZE
  const deadline = startOfDay(new Date(c.deadline))
  const today = startOfDay(now)

  const forDeck = state.checkpoints.filter((cp) => cp.deckId === (c.deckId ?? null))
  const qualifying = forDeck.filter((cp) => cp.total >= minCards && cp.score >= target)
  const best = forDeck.reduce<number | null>((b, cp) => (b === null || cp.score > b ? cp.score : b), null)
  const progressPct = best === null ? 0 : Math.min(1, best / target)

  if (qualifying.length > 0) {
    return { status: 'met', headline: 'Verified ✓', detail: `Passed a recall checkpoint at or above target.`, progressPct: 1, verifiedRetention: best }
  }
  if (today >= deadline) {
    return { status: 'failed', headline: 'Missed', detail: `Deadline passed without a passing checkpoint.`, progressPct, verifiedRetention: best }
  }
  const bestTxt = best === null ? 'none yet' : `${Math.round(best * 100)}%`
  return {
    status: 'active',
    headline: `Need a verified ${Math.round(target * 100)}%`,
    detail: `Take a recall checkpoint of ≥${minCards} cards. Best so far: ${bestTxt}.`,
    progressPct,
    verifiedRetention: best,
  }
}

export function evaluateCommitment(state: AppState, c: Commitment, now: Date): CommitmentEval {
  return c.kind === 'daily-reviews' ? evalDailyReviews(state, c, now) : evalRetentionGoal(state, c, now)
}

/**
 * Resolve any active commitments that have reached a terminal state (derailed,
 * verified, or past deadline). Returns the same array reference if nothing
 * changed, so callers can skip a re-render.
 */
export function resolveCommitments(state: AppState, now: Date): Commitment[] {
  let changed = false
  const next = state.commitments.map((c) => {
    if (c.status !== 'active') return c
    const ev = evaluateCommitment(state, c, now)
    if (ev.status === 'active') return c
    changed = true
    return { ...c, status: ev.status, resolvedAt: now.toISOString() }
  })
  return changed ? next : state.commitments
}

// ---- demo stakes ledger ---------------------------------------------------

export interface Ledger {
  atRiskCents: number
  forfeitedCents: number
  honoredCents: number
}

export function computeLedger(commitments: Commitment[]): Ledger {
  const ledger: Ledger = { atRiskCents: 0, forfeitedCents: 0, honoredCents: 0 }
  for (const c of commitments) {
    if (c.status === 'active') ledger.atRiskCents += c.stakeCents
    else if (c.status === 'failed') ledger.forfeitedCents += c.stakeCents
    else if (c.status === 'met') ledger.honoredCents += c.stakeCents
  }
  return ledger
}

// ---- verified-recall checkpoints ------------------------------------------

/** Normalize for forgiving exact-match grading. */
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?'"()[\]]/g, '')
}

export function gradeAnswer(expected: string, given: string): boolean {
  const e = normalize(expected)
  const g = normalize(given)
  return g.length > 0 && e === g
}

/** The gradeable answer for a card (basic back, or the tested cloze's text). */
export function cardAnswer(note: Note, card: Card): string {
  if (note.type === 'cloze') return clozeAnswer(note.fields.text ?? '', card.ord + 1)
  return note.fields.back ?? ''
}

export interface CheckpointCard {
  card: Card
  note: Note
  question: string
  expected: string
}

/**
 * Sample up to `size` already-reviewed cards from a deck (null = all) for a
 * checkpoint. Deterministic (sorted by id) so it's reproducible/testable.
 */
export function sampleCheckpointCards(
  state: AppState,
  deckId: string | null,
  size: number,
  renderQuestion: (note: Note, card: Card) => string,
): CheckpointCard[] {
  const reviewed = new Set(state.events.map((e) => e.cardId))
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const pool = state.cards
    .filter((c) => (deckId === null || c.deckId === deckId) && reviewed.has(c.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, size)

  const out: CheckpointCard[] = []
  for (const card of pool) {
    const note = notesById.get(card.noteId)
    if (!note) continue
    out.push({ card, note, question: renderQuestion(note, card), expected: cardAnswer(note, card) })
  }
  return out
}

/** Clamp a requested stake to the allowed range. */
export function clampStake(cents: number): number {
  if (!Number.isFinite(cents) || cents < 0) return 0
  return Math.min(STAKE_CAP_CENTS, Math.round(cents))
}
