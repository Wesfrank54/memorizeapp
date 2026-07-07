import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs'
import type { Card as FsrsCard, Grade } from 'ts-fsrs'
import type { ReviewEvent } from './types.ts'

/** The retention target the scheduler is built with — due date = the moment
 * retrievability drops to this. Exported so consumers (e.g. Study now) judge
 * "fading" by the same threshold the scheduler actually uses. */
export const REQUEST_RETENTION = 0.9

/**
 * Build a scheduler. `enable_fuzz: false` keeps replay a pure function of the
 * event log (the Phase 0 convergence guarantee). Optional `weights` are the
 * user's personalized FSRS-6 weights from the optimizer (Phase 3).
 */
function buildScheduler(weights: number[] | null) {
  return fsrs(
    generatorParameters({
      enable_fuzz: false,
      request_retention: REQUEST_RETENTION,
      ...(weights && weights.length ? { w: weights } : {}),
    }),
  )
}

// The active scheduler. Default FSRS-6 weights until the user optimizes their
// own, at which point configureScheduler() swaps them in. Because every card's
// schedule is *derived* from the event log, changing weights just changes this
// pure function — recomputeCard() yields the new schedule with no migration.
let activeWeights: number[] | null = null
let scheduler = buildScheduler(null)

export function configureScheduler(weights?: number[] | null): void {
  activeWeights = weights && weights.length ? [...weights] : null
  scheduler = buildScheduler(activeWeights)
}

export function getActiveWeights(): number[] | null {
  return activeWeights
}

/** Total order over events: by review instant, tie-broken by id. */
export function orderEvents(a: ReviewEvent, b: ReviewEvent): number {
  const ta = Date.parse(a.reviewedAt)
  const tb = Date.parse(b.reviewedAt)
  if (ta !== tb) return ta - tb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Replay a card's events through FSRS to derive its authoritative state. */
export function recomputeCard(events: ReviewEvent[]): FsrsCard {
  const ordered = [...events].sort(orderEvents)
  if (ordered.length === 0) return createEmptyCard()
  let card = createEmptyCard(new Date(ordered[0].reviewedAt))
  for (const ev of ordered) {
    card = scheduler.next(card, new Date(ev.reviewedAt), ev.rating).card
  }
  return card
}

/** Probability of recall (0..1) for a card at a given instant. */
export function retrievability(card: FsrsCard, at: Date): number {
  return scheduler.get_retrievability(card, at, false)
}

const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

/** Human-friendly gap label, e.g. "<1m", "10m", "4d", "2mo". */
export function formatGap(ms: number): string {
  const min = ms / 60000
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const hr = min / 60
  if (hr < 24) return `${Math.round(hr)}h`
  const day = hr / 24
  if (day < 30) return `${Math.round(day)}d`
  const mo = day / 30
  if (mo < 12) return `${Math.round(mo)}mo`
  return `${(day / 365).toFixed(1)}y`
}

/** Next-interval preview for each rating button (Again/Hard/Good/Easy). */
export function previewIntervals(card: FsrsCard, now: Date): Record<Grade, string> {
  const preview = scheduler.repeat(card, now)
  const out = {} as Record<Grade, string>
  for (const g of GRADES) {
    const due = new Date(preview[g].card.due).getTime()
    out[g] = formatGap(due - now.getTime())
  }
  return out
}
