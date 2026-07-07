import type { Card as FsrsCard } from 'ts-fsrs'
import type { AppState, Card, Note, ReviewEvent, ReviewItem } from './types.ts'
import { recomputeCard } from './fsrs.ts'
import { renderCloze } from './cloze.ts'

/** Group every event by card id. */
export function eventsByCard(events: ReviewEvent[]): Map<string, ReviewEvent[]> {
  const map = new Map<string, ReviewEvent[]>()
  for (const ev of events) {
    const list = map.get(ev.cardId)
    if (list) list.push(ev)
    else map.set(ev.cardId, [ev])
  }
  return map
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Render a card to question/answer text based on its note type. */
export function renderContent(note: Note, card: Card): { question: string; answer: string } {
  if (note.type === 'cloze') {
    return renderCloze(note.fields.text ?? '', card.ord + 1)
  }
  return { question: note.fields.front ?? '', answer: note.fields.back ?? '' }
}

/**
 * The study queue for `now`: cards whose derived due date has passed, plus up to
 * the remaining daily allowance of brand-new cards. Due reviews are ordered by
 * due date (which naturally interleaves decks); new cards follow.
 *
 * After the scheduled items we also append any remaining previously-seen cards
 * (unlimited extra practice). This makes the Review feature (and its answer
 * modes) usable any time with no "done for the day" hard stop once the daily
 * dues + new allowance are cleared.
 */
export function dueQueue(state: AppState, now: Date): ReviewItem[] {
  const byCard = eventsByCard(state.events)
  const notesById = new Map(state.notes.map((n) => [n.id, n]))
  const deckNames = new Map(state.decks.map((d) => [d.id, d.name]))

  // How many new cards were already introduced today?
  let introducedToday = 0
  for (const evs of byCard.values()) {
    const first = evs.reduce((a, b) => (Date.parse(a.reviewedAt) <= Date.parse(b.reviewedAt) ? a : b))
    if (isSameDay(new Date(first.reviewedAt), now)) introducedToday++
  }
  const newAllowance = Math.max(0, state.settings.newPerDay - introducedToday)

  const due: { item: ReviewItem; dueAt: number }[] = []
  const fresh: ReviewItem[] = []

  for (const card of state.cards) {
    const note = notesById.get(card.noteId)
    if (!note) continue
    const { question, answer } = renderContent(note, card)
    const deckName = deckNames.get(card.deckId) ?? '—'
    const evs = byCard.get(card.id)

    if (!evs || evs.length === 0) {
      fresh.push({ card, note, deckName, question, answer, fsrs: recomputeCard([]), isNew: true })
      continue
    }
    const fsrs = recomputeCard(evs)
    if (new Date(fsrs.due).getTime() <= now.getTime()) {
      due.push({ item: { card, note, deckName, question, answer, fsrs, isNew: false }, dueAt: new Date(fsrs.due).getTime() })
    }
  }

  due.sort((a, b) => a.dueAt - b.dueAt)
  const scheduled = [...due.map((d) => d.item), ...fresh.slice(0, newAllowance)]

  // Unlimited practice support: after scheduled dues + daily new allowance,
  // include any remaining previously-seen cards (not due, not brand new).
  // This lets the review feature (and its modes) be used indefinitely for extra
  // practice/reviews at any time, instead of blocking with "all caught up".
  // Extras are sorted by stability asc (weakest/most in need of practice first).
  const scheduledIds = new Set(scheduled.map((i) => i.card.id))
  const extra: ReviewItem[] = []
  for (const card of state.cards) {
    if (scheduledIds.has(card.id)) continue
    const note = notesById.get(card.noteId)
    if (!note) continue
    const { question, answer } = renderContent(note, card)
    const deckName = deckNames.get(card.deckId) ?? '—'
    const evs = byCard.get(card.id)
    if (!evs || evs.length === 0) continue // already handled as fresh
    const fsrs = recomputeCard(evs)
    extra.push({ card, note, deckName, question, answer, fsrs, isNew: false })
  }
  extra.sort((a, b) => (a.fsrs.stability ?? Infinity) - (b.fsrs.stability ?? Infinity))

  return [...scheduled, ...extra]
}

/** Pull highlighted (recently learn-graduated) cards to the front of the review queue. */
export function prioritizeQueue(queue: ReviewItem[], highlightIds: string[]): ReviewItem[] {
  if (highlightIds.length === 0) return queue
  const set = new Set(highlightIds)
  const front = queue.filter((i) => set.has(i.card.id))
  const rest = queue.filter((i) => !set.has(i.card.id))
  return [...front, ...rest]
}

/** Derived FSRS state for a single card (or an empty card if never reviewed). */
export function cardState(state: AppState, cardId: string): FsrsCard {
  return recomputeCard(state.events.filter((e) => e.cardId === cardId))
}
