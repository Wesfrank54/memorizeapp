import { State } from 'ts-fsrs'
import type { AppState } from './types.ts'
import { eventsByCard } from './schedule.ts'
import { recomputeCard, orderEvents } from './fsrs.ts'

export interface DeckStat {
  deckId: string
  name: string
  total: number
  due: number
  new: number
}

export interface Stats {
  totalCards: number
  newCount: number
  dueToday: number
  reviewsToday: number
  learningCount: number
  reviewCount: number
  /** Pass rate over mature reviews in the last 30 days, or null if none yet. */
  trueRetention30d: number | null
  perDeck: DeckStat[]
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function computeStats(state: AppState, now: Date): Stats {
  const byCard = eventsByCard(state.events)
  const deckById = new Map(state.decks.map((d) => [d.id, d]))
  const perDeck = new Map<string, DeckStat>()
  for (const d of state.decks) perDeck.set(d.id, { deckId: d.id, name: d.name, total: 0, due: 0, new: 0 })

  let newCount = 0
  let dueToday = 0
  let learningCount = 0
  let reviewCount = 0

  for (const card of state.cards) {
    const ds = perDeck.get(card.deckId)
    if (ds) ds.total++
    const evs = byCard.get(card.id)
    if (!evs || evs.length === 0) {
      newCount++
      if (ds) ds.new++
      continue
    }
    const fsrs = recomputeCard(evs)
    if (fsrs.state === State.Learning || fsrs.state === State.Relearning) learningCount++
    else if (fsrs.state === State.Review) reviewCount++
    if (new Date(fsrs.due).getTime() <= now.getTime()) {
      dueToday++
      if (ds) ds.due++
    }
  }

  // Reviews done today + true retention over mature reviews (not a card's first).
  let reviewsToday = 0
  let maturePass = 0
  let matureTotal = 0
  const windowStart = now.getTime() - 30 * 24 * 3600 * 1000
  for (const evs of byCard.values()) {
    const ordered = [...evs].sort(orderEvents)
    ordered.forEach((ev, i) => {
      const t = Date.parse(ev.reviewedAt)
      if (isSameDay(new Date(t), now)) reviewsToday++
      if (i > 0 && t >= windowStart) {
        matureTotal++
        if (ev.rating > 1) maturePass++ // not "Again"
      }
    })
  }

  return {
    totalCards: state.cards.length,
    newCount,
    dueToday,
    reviewsToday,
    learningCount,
    reviewCount,
    trueRetention30d: matureTotal === 0 ? null : maturePass / matureTotal,
    perDeck: [...perDeck.values()].sort((a, b) => (deckById.get(a.deckId)?.name ?? '').localeCompare(deckById.get(b.deckId)?.name ?? '')),
  }
}
