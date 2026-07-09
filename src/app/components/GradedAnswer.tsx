import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AppState, Card, Note } from '../../core/types.ts'
import { cardAnswer } from '../../core/accountability.ts'
import { blankIsWorthwhile, resolveGradedMode, type GradedMode } from '../../core/answer-modes.ts'
import { gradeChoice, gradeText, makeChoices, normalize } from '../../core/grading.ts'
import type { GradeResult } from '../../core/grading.ts'
import { LiveTypingMarks } from './LiveTypingMarks.tsx'
import { VerdictBanner } from './VerdictBanner.tsx'

export type { GradedMode }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** First-letter cue for fill-blank mode, e.g. "Davy Jones" -> "D___ J____". */
function firstLetterHint(answer: string): string {
  return answer
    .trim()
    .split(/\s+/)
    .map((w) => (w[0] ? w[0] + '_'.repeat(Math.max(0, w.length - 1)) : ''))
    .join(' ')
}

/** Progressive hint: coverage 0 = first letters only; 1 = fully blanked words. */
function progressiveHint(answer: string, coverage: number): string {
  const c = Math.max(0, Math.min(1, coverage))
  if (c <= 0.35) return firstLetterHint(answer)
  return answer
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (!w[0]) return ''
      const reveal = Math.max(1, Math.round(w.length * (1 - c)))
      return w.slice(0, reveal) + '_'.repeat(Math.max(0, w.length - reveal))
    })
    .join(' ')
}

export interface GradedAnswerContext {
  mode: GradedMode
  requested: GradedMode
  fallbackReason?: string
}

type AnswerPhase = 'typing' | 'verdict'

/**
 * Renders the answer interaction for one card in a graded mode and reports the
 * result. Shared by the Review tab (drives SRS) and the Quiz tab (scoring only):
 *   - typed / blank → free-text input, graded with near-miss tolerance
 *   - mcq           → multiple choice from auto-generated distractors
 * MCQ/blank requests downgrade to typed when quality gates fail (same rules as Learn).
 */
export function GradedAnswer({
  state,
  card,
  note,
  mode,
  blankCoverage,
  onGraded,
}: {
  state: AppState
  card: Card
  note: Note
  mode: GradedMode
  /** When set, blank mode uses progressive reveal (learn-mode rung scaling). */
  blankCoverage?: number
  onGraded: (r: GradeResult, ctx: GradedAnswerContext) => void
}) {
  const expected = cardAnswer(note, card)
  const resolved = useMemo(
    () => resolveGradedMode(state, card, note, mode),
    [state, card, note, mode],
  )
  const activeMode = resolved.mode

  const options = useMemo(
    () => (activeMode === 'mcq' ? shuffle(makeChoices(state, card, note, 4)) : []),
    [state, card, note, activeMode],
  )

  const [phase, setPhase] = useState<AnswerPhase>('typing')
  const [input, setInput] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [result, setResult] = useState<GradeResult | null>(null)
  const advancedRef = useRef(false)
  const phaseRef = useRef(phase)
  const resultRef = useRef(result)
  const inputRef = useRef(input)
  const onGradedRef = useRef(onGraded)
  const rootRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  phaseRef.current = phase
  resultRef.current = result
  inputRef.current = input
  onGradedRef.current = onGraded

  const gradedCtx = useMemo<GradedAnswerContext>(
    () => ({
      mode: activeMode,
      requested: resolved.requested,
      fallbackReason: resolved.fallbackReason,
    }),
    [activeMode, resolved.requested, resolved.fallbackReason],
  )

  useEffect(() => {
    setPhase('typing')
    setInput('')
    setPicked(null)
    setResult(null)
    advancedRef.current = false
  }, [card.id, activeMode])

  function keyOwner() {
    const active = document.activeElement
    return !!active && !!rootRef.current?.contains(active)
  }

  /** After the input unmounts, focus often lands on <body> — still allow Enter → Next. */
  function focusAllowsVerdictEnter() {
    const active = document.activeElement
    if (!active) return false
    if (rootRef.current?.contains(active)) return true
    return active === document.body || active === document.documentElement
  }

  function revealVerdict(graded: GradeResult) {
    if (phaseRef.current !== 'typing') return
    setResult(graded)
    setPhase('verdict')
  }

  function checkTypedAnswer() {
    revealVerdict(gradeText(expected, inputRef.current))
  }

  function advance() {
    const graded = resultRef.current
    if (phaseRef.current !== 'verdict' || !graded || advancedRef.current) return
    advancedRef.current = true
    onGradedRef.current(graded, gradedCtx)
  }

  useLayoutEffect(() => {
    if (phase !== 'verdict') return
    nextRef.current?.focus()
  }, [phase, card.id, result])

  useEffect(() => {
    if (activeMode === 'mcq') return
    function onKeyDown(e: KeyboardEvent) {
      if (phaseRef.current !== 'typing' || e.key !== 'Enter' || e.repeat || !keyOwner()) return
      e.preventDefault()
      setResult(gradeText(expected, inputRef.current))
      setPhase('verdict')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeMode, expected, card.id])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (phaseRef.current !== 'verdict' || e.key !== 'Enter' || e.repeat || !focusAllowsVerdictEnter()) return
      e.preventDefault()
      advance()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [gradedCtx, card.id])

  function pick(opt: string) {
    if (phase !== 'typing') return
    setPicked(opt)
    revealVerdict(gradeChoice(expected, opt))
  }

  const verdict =
    phase === 'verdict' && result ? (
      <div className="graded-verdict-screen">
        <VerdictBanner correct={result.correct} near={result.near} expected={expected} />
        <button ref={nextRef} type="button" className="primary reveal" onClick={advance}>
          Next <span className="hint">enter</span>
        </button>
      </div>
    ) : null

  const fallbackNote =
    resolved.fallbackReason && (
      <p className="muted small mode-fallback-note">{resolved.fallbackReason}</p>
    )

  if (activeMode === 'mcq') {
    return (
      <div className="graded" ref={rootRef}>
        {fallbackNote}
        <div className="mcq-options">
          {options.map((opt) => {
            const isCorrect = normalize(opt) === normalize(expected)
            const cls = phase === 'verdict' ? (isCorrect ? 'mcq-correct' : opt === picked ? 'mcq-wrong' : '') : ''
            return (
              <button
                key={opt}
                type="button"
                className={`mcq-option ${cls}`}
                disabled={phase === 'verdict'}
                onClick={() => pick(opt)}
              >
                {opt}
              </button>
            )
          })}
        </div>
        {verdict}
      </div>
    )
  }

  return (
    <div className="graded" ref={rootRef}>
      {fallbackNote}
      {phase === 'typing' ? (
        <>
          {activeMode === 'blank' && blankIsWorthwhile(expected) && (
            <div className="blank-hint">
              {blankCoverage !== undefined ? progressiveHint(expected, blankCoverage) : firstLetterHint(expected)}
            </div>
          )}
          <p className="muted small typing-live-hint">
            Press <strong>Check</strong> or Enter to see if you got it right, then Enter again to continue. While
            typing, words turn <span className="w-ok">green</span> when right and <span className="w-no">red</span>{' '}
            when off.
          </p>
          <LiveTypingMarks expected={expected} given={input} />
          <input
            className="cp-input"
            autoFocus
            value={input}
            placeholder={activeMode === 'blank' ? 'fill in the blank…' : 'type the answer from memory…'}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="button" className="primary reveal" onClick={checkTypedAnswer}>
            Check <span className="hint">enter</span>
          </button>
        </>
      ) : (
        <>
          <LiveTypingMarks expected={expected} given={input} graded />
          {verdict}
        </>
      )}
    </div>
  )
}