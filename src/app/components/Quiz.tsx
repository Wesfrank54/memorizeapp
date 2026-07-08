import { useEffect, useMemo, useState } from 'react'
import type { AppState, Card, Note } from '../../core/types.ts'
import { renderContent } from '../../core/schedule.ts'
import { recordQuizAttempt } from '../../core/store.ts'
import { computeConcepts } from '../../core/concepts.ts'
import { buildUnits } from '../../core/learn.ts'
import { GradedAnswer, type GradedMode } from './GradedAnswer.tsx'

const MODES: { id: GradedMode; label: string }[] = [
  { id: 'typed', label: 'Type' },
  { id: 'blank', label: 'Fill blank' },
  { id: 'mcq', label: 'Choices' },
]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface QuizSession {
  remaining: { card: Card; note: Note }[]
  deferred: { card: Card; note: Note }[]
  catchUp: boolean
  correct: number
  planned: number
  answered: number
}

export function Quiz({ state }: { state: AppState }) {
  const [deckId, setDeckId] = useState('')
  const [mode, setMode] = useState<GradedMode>('typed')
  const [length, setLength] = useState(10)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [session, setSession] = useState<QuizSession | null>(null)

  const deckCardIds = useMemo(
    () => state.cards.filter((c) => !deckId || c.deckId === deckId).map((c) => c.id),
    [state.cards, deckId],
  )
  // Same concept grouping the Learn tab uses (first tag → deck fallback).
  const allUnits = useMemo(() => buildUnits(state, deckCardIds, { byConcept: true }), [state, deckCardIds])
  const chosenCardIds = useMemo(
    () => allUnits.filter((u) => selectedKeys.has(u.key)).flatMap((u) => u.cardIds),
    [allUnits, selectedKeys],
  )
  const available = chosenCardIds.length

  // Default to every topic selected (quiz the whole deck) and reset on deck change.
  useEffect(() => {
    setSelectedKeys(new Set(allUnits.map((u) => u.key)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId])

  function toggleUnit(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function start() {
    const notesById = new Map(state.notes.map((n) => [n.id, n]))
    const idSet = new Set(chosenCardIds)
    const pool = state.cards
      .filter((c) => idSet.has(c.id))
      .map((c) => ({ card: c, note: notesById.get(c.noteId) }))
      .filter((x): x is { card: Card; note: Note } => !!x.note)
    const picked = shuffle(pool).slice(0, length)
    if (picked.length === 0) return
    setSession({ remaining: picked, deferred: [], catchUp: false, correct: 0, planned: picked.length, answered: 0 })
  }

  function skip() {
    setSession((s) => {
      if (!s) return s
      if (s.catchUp) {
        const [cur, ...rest] = s.deferred
        if (!cur) return s
        return { ...s, deferred: [...rest, cur] }
      }
      const [cur, ...rest] = s.remaining
      if (!cur) return s
      return { ...s, remaining: rest, deferred: [...s.deferred, cur] }
    })
  }

  const current = session ? (session.catchUp ? session.deferred[0] : session.remaining[0]) : undefined

  useEffect(() => {
    if (!session || session.catchUp) return
    if (session.remaining.length === 0 && session.deferred.length > 0) {
      setSession((s) => (s ? { ...s, catchUp: true } : s))
    }
  }, [session])

  useEffect(() => {
    if (!current) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 's' && e.key !== 'S') return
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      e.preventDefault()
      skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current?.card.id, session?.catchUp])

  if (!session) {
    return (
      <div className="panel form">
        <h2 className="opt-title">Quiz</h2>
        <p className="muted small">
          A graded run that scores you and updates weak-concept stats — without changing your review schedule.
        </p>
        <div className="field">
          <label>Deck</label>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">All decks</option>
            {state.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <div className="row spread">
            <label>Topics</label>
            <span className="muted small">
              {allUnits.filter((u) => selectedKeys.has(u.key)).length} of {allUnits.length} selected · {available} cards
            </span>
          </div>
          {allUnits.length > 0 ? (
            <>
              <div className="unit-picker-actions">
                <button type="button" className="link" onClick={() => setSelectedKeys(new Set(allUnits.map((u) => u.key)))}>
                  select all
                </button>
                <button type="button" className="link" onClick={() => setSelectedKeys(new Set())}>
                  clear
                </button>
              </div>
              <div className="unit-picker">
                {allUnits.map((u) => (
                  <label key={u.key} className={`unit-chip selectable${selectedKeys.has(u.key) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={selectedKeys.has(u.key)} onChange={() => toggleUnit(u.key)} />
                    <span>
                      {u.label} <span className="muted">({u.cardIds.length})</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">No cards in this deck.</p>
          )}
        </div>
        <div className="field">
          <label>Answer mode</label>
          <div className="row toggle">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Questions</label>
          <div className="row">
            <input type="number" min={1} max={available || 1} value={length} onChange={(e) => setLength(Number(e.target.value))} />
            <span className="muted small">{available} cards available</span>
          </div>
        </div>
        <button className="primary" onClick={start} disabled={available === 0}>
          Start quiz
        </button>
      </div>
    )
  }

  if (!current && session.remaining.length === 0 && session.deferred.length === 0) {
    const pct = session.answered > 0 ? Math.round((session.correct / session.answered) * 100) : 0
    const weak = computeConcepts(state, { minAttempts: 1 }).slice(0, 5)
    return (
      <div className="panel center">
        <div className="cp-score">{pct}%</div>
        <p>
          {session.correct} / {session.answered} correct
          {session.answered < session.planned ? (
            <span className="muted small"> · {session.planned - session.answered} skipped</span>
          ) : null}
        </p>
        {weak.length > 0 && (
          <div className="quiz-weak">
            <div className="stat-label">weakest concepts</div>
            {weak.map((c) => (
              <div key={c.key} className="concept-row">
                <span>{c.label}</span>
                <span className="muted small">{Math.round(c.accuracy * 100)}% · {c.attempts}</span>
              </div>
            ))}
          </div>
        )}
        <button className="primary" onClick={() => setSession(null)}>
          done
        </button>
      </div>
    )
  }

  if (!current) return null

  const { card, note } = current
  const { question } = renderContent(note, card)
  const doneCount = session.answered
  const progressLabel = session.catchUp
    ? `Catch-up · ${session.deferred.length} remaining`
    : `quiz · ${doneCount + 1} / ${session.planned}`
  const deferredCount = session.catchUp ? 0 : session.deferred.length

  function advance(correct: boolean) {
    setSession((s) => {
      if (!s) return s
      if (s.catchUp) {
        const next = {
          ...s,
          deferred: s.deferred.slice(1),
          correct: s.correct + (correct ? 1 : 0),
          answered: s.answered + 1,
        }
        return next
      }
      const next = {
        ...s,
        remaining: s.remaining.slice(1),
        correct: s.correct + (correct ? 1 : 0),
        answered: s.answered + 1,
      }
      if (next.remaining.length === 0 && next.deferred.length > 0) {
        return { ...next, catchUp: true }
      }
      return next
    })
  }

  return (
    <div className="panel review">
      <div className="cp-progress">
        {progressLabel}
        {deferredCount > 0 ? <span className="deferred-badge"> · {deferredCount} deferred</span> : null}
      </div>
      <div className="card-face question">{question}</div>
      <GradedAnswer
        key={card.id}
        state={state}
        card={card}
        note={note}
        mode={mode}
        blankCoverage={mode === 'blank' ? (state.settings.blankCoverage ?? 0.5) : undefined}
        onGraded={(r, ctx) => {
          recordQuizAttempt(card.id, ctx.mode, r.correct)
          advance(r.correct)
        }}
      />
      <div className="skip-row">
        <button type="button" className="link skip-link" onClick={skip} title="Keyboard: S">
          Skip · come back later
        </button>
      </div>
    </div>
  )
}