import { useCallback, useEffect, useMemo, useState } from 'react'
import { Rating } from 'ts-fsrs'
import type { AnswerMode, AppState, Grade, ReviewItem } from '../../core/types.ts'
import { dueQueue, prioritizeQueue } from '../../core/schedule.ts'
import { previewIntervals } from '../../core/fsrs.ts'
import { isLearnHighlightActive } from '../../core/learn.ts'
import { markLearnHighlightReviewed, review, submitGradedReview, updateSettings } from '../../core/store.ts'
import { GradedAnswer, type GradedMode } from './GradedAnswer.tsx'

const RATINGS: { grade: Grade; label: string; cls: string }[] = [
  { grade: Rating.Again, label: 'Again', cls: 'again' },
  { grade: Rating.Hard, label: 'Hard', cls: 'hard' },
  { grade: Rating.Good, label: 'Good', cls: 'good' },
  { grade: Rating.Easy, label: 'Easy', cls: 'easy' },
]

const MODES: { id: AnswerMode; label: string }[] = [
  { id: 'self', label: 'Self-rate' },
  { id: 'typed', label: 'Type' },
  { id: 'blank', label: 'Fill blank' },
  { id: 'mcq', label: 'Choices' },
]

export function ReviewSession({ state }: { state: AppState }) {
  const mode = state.settings.answerMode ?? 'self'
  const [deferredIds, setDeferredIds] = useState<string[]>([])
  const [catchUp, setCatchUp] = useState(false)

  const now = useMemo(() => new Date(), [state])
  const highlightIds = useMemo(() => {
    if (!isLearnHighlightActive(state.learnHighlight)) return []
    return state.learnHighlight!.cardIds
  }, [state.learnHighlight])
  const fullQueue = useMemo(
    () => prioritizeQueue(dueQueue(state, now), highlightIds),
    [state, now, highlightIds],
  )

  const mainQueue = useMemo(
    () => fullQueue.filter((i) => !deferredIds.includes(i.card.id)),
    [fullQueue, deferredIds],
  )

  const deferredQueue = useMemo(
    () =>
      deferredIds
        .map((id) => fullQueue.find((i) => i.card.id === id))
        .filter((x): x is ReviewItem => !!x),
    [fullQueue, deferredIds],
  )

  useEffect(() => {
    setDeferredIds((ids) => ids.filter((id) => fullQueue.some((i) => i.card.id === id)))
  }, [fullQueue])

  useEffect(() => {
    if (mainQueue.length === 0 && deferredQueue.length > 0) setCatchUp(true)
    if (deferredQueue.length === 0) setCatchUp(false)
  }, [mainQueue.length, deferredQueue.length])

  const item = catchUp ? deferredQueue[0] : mainQueue[0]
  const deferredCount = catchUp ? deferredQueue.length : deferredIds.length

  const [revealed, setRevealed] = useState(false)
  const [shownAt, setShownAt] = useState(() => Date.now())

  useEffect(() => {
    setRevealed(false)
    setShownAt(Date.now())
  }, [item?.card.id, mode])

  const clearDeferred = useCallback((cardId: string) => {
    setDeferredIds((ids) => ids.filter((id) => id !== cardId))
  }, [])

  const rate = useCallback(
    (grade: Grade) => {
      if (!item) return
      clearDeferred(item.card.id)
      markLearnHighlightReviewed(item.card.id)
      review(item.card.id, grade, Date.now() - shownAt)
    },
    [item, shownAt, clearDeferred],
  )

  const skip = useCallback(() => {
    if (!item) return
    if (catchUp) {
      setDeferredIds((ids) => {
        const rest = ids.filter((id) => id !== item.card.id)
        return [...rest, item.card.id]
      })
    } else {
      setDeferredIds((ids) => (ids.includes(item.card.id) ? ids : [...ids, item.card.id]))
    }
  }, [item, catchUp])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 's' && e.key !== 'S') return
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      if (!item) return
      e.preventDefault()
      skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, skip])

  useEffect(() => {
    if (mode !== 'self') return
    function onKey(e: KeyboardEvent) {
      if (!item) return
      if (!revealed && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && e.key >= '1' && e.key <= '4') {
        rate(RATINGS[Number(e.key) - 1].grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, revealed, rate, mode])

  const selector = (
    <div className="mode-selector">
      {MODES.map((m) => (
        <button
          key={m.id}
          className={mode === m.id ? 'active' : ''}
          onClick={() => updateSettings({ answerMode: m.id })}
        >
          {m.label}
        </button>
      ))}
    </div>
  )

  if (!item) {
    return (
      <div>
        {selector}
        <div className="panel center">
          <div className="done-mark">✓</div>
          <h2>All caught up</h2>
          <p className="muted">No cards available to review right now. Add more cards to keep going.</p>
        </div>
      </div>
    )
  }

  const previews = previewIntervals(item.fsrs, now)
  const phaseLabel = catchUp ? `Catch-up · ${deferredQueue.length} remaining` : 'Review'

  return (
    <div>
      {selector}
      <div className="panel review">
        <div className="review-meta">
          <span className="chip">{item.deckName}</span>
          <span className={`chip ${item.isNew ? 'chip-new' : 'chip-due'}`}>{item.isNew ? 'new' : 'review'}</span>
          {catchUp ? <span className="chip chip-due">catch-up</span> : null}
          <span className="muted small review-phase">{phaseLabel}</span>
          {deferredCount > 0 && !catchUp ? (
            <span className="deferred-badge">{deferredCount} deferred</span>
          ) : null}
          {highlightIds.includes(item.card.id) ? (
            <span className="chip chip-new">from learn</span>
          ) : null}
        </div>

        {highlightIds.includes(item.card.id) ? (
          <p className="muted small learn-highlight-note">Recently mastered in Learn — review while it&apos;s fresh.</p>
        ) : null}

        <div className="card-face question">{item.question}</div>

        {mode === 'self' ? (
          revealed ? (
            <>
              <hr className="divider" />
              <div className="card-face answer">{item.answer}</div>
              <div className="rating-row">
                {RATINGS.map((r, i) => (
                  <button key={r.grade} className={`rate ${r.cls}`} onClick={() => rate(r.grade)}>
                    <span className="rate-label">{r.label}</span>
                    <span className="rate-ivl">{previews[r.grade]}</span>
                    <span className="rate-key">{i + 1}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className="primary reveal" onClick={() => setRevealed(true)}>
              Show answer <span className="hint">space</span>
            </button>
          )
        ) : (
          <GradedAnswer
            key={item.card.id}
            state={state}
            card={item.card}
            note={item.note}
            mode={mode as GradedMode}
            blankCoverage={mode === 'blank' ? (state.settings.blankCoverage ?? 0.5) : undefined}
            onGraded={(r, ctx) => {
              clearDeferred(item.card.id)
              markLearnHighlightReviewed(item.card.id)
              submitGradedReview(item.card.id, ctx.mode, r, Date.now() - shownAt)
            }}
          />
        )}
        <div className="skip-row">
          <button type="button" className="link skip-link" onClick={skip} title="Keyboard: S">
            Skip · come back later
          </button>
        </div>
      </div>
    </div>
  )
}