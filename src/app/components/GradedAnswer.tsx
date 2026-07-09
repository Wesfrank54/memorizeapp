import { useEffect, useMemo, useRef, useState } from 'react'
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

  const [input, setInput] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [result, setResult] = useState<GradeResult | null>(null)
  const advancedRef = useRef(false)
  /** After checking with Enter, release the key before Enter can advance (same as Learn passages). */
  const advanceReadyRef = useRef(false)
  const inputRef = useRef(input)
  const onGradedRef = useRef(onGraded)
  inputRef.current = input
  onGradedRef.current = onGraded

  useEffect(() => {
    setInput('')
    setPicked(null)
    setResult(null)
    advancedRef.current = false
    advanceReadyRef.current = false
  }, [card.id, activeMode])

  useEffect(() => {
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Enter') advanceReadyRef.current = true
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [])

  const gradedCtx = useMemo<GradedAnswerContext>(
    () => ({
      mode: activeMode,
      requested: resolved.requested,
      fallbackReason: resolved.fallbackReason,
    }),
    [activeMode, resolved.requested, resolved.fallbackReason],
  )

  function advance() {
    if (!result || advancedRef.current) return
    advancedRef.current = true
    onGradedRef.current(result, gradedCtx)
  }

  function checkAnswer(fromEnter = false) {
    if (result) return
    advanceReadyRef.current = !fromEnter
    setResult(gradeText(expected, inputRef.current))
  }

  function enterTargetAllowsAction(el: HTMLElement) {
    return el.tagName !== 'BUTTON' && el.tagName !== 'A' && el.tagName !== 'SELECT'
  }

  useEffect(() => {
    if (result || activeMode === 'mcq') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat) return
      const el = e.target as HTMLElement
      if (!enterTargetAllowsAction(el)) return
      e.preventDefault()
      checkAnswer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, activeMode, expected])

  useEffect(() => {
    if (!result) return
    const graded = result
    advancedRef.current = false
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat) return
      const el = e.target as HTMLElement
      if (!enterTargetAllowsAction(el)) return
      e.preventDefault()
      if (!advanceReadyRef.current || advancedRef.current) return
      advancedRef.current = true
      onGradedRef.current(graded, gradedCtx)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result, gradedCtx])
  function pick(opt: string) {
    if (result) return
    setPicked(opt)
    advanceReadyRef.current = true
    setResult(gradeChoice(expected, opt))
  }

  const feedback = result && (
    <div className="graded-feedback">
      <VerdictBanner correct={result.correct} near={result.near} expected={expected} />
      <button className="primary reveal" autoFocus onClick={advance}>
        Next <span className="hint">enter</span>
      </button>
    </div>
  )

  const fallbackNote =
    resolved.fallbackReason && (
      <p className="muted small mode-fallback-note">{resolved.fallbackReason}</p>
    )

  if (activeMode === 'mcq') {
    return (
      <div className="graded">
        {fallbackNote}
        <div className="mcq-options">
          {options.map((opt) => {
            const isCorrect = normalize(opt) === normalize(expected)
            const cls = result ? (isCorrect ? 'mcq-correct' : opt === picked ? 'mcq-wrong' : '') : ''
            return (
              <button key={opt} className={`mcq-option ${cls}`} disabled={!!result} onClick={() => pick(opt)}>
                {opt}
              </button>
            )
          })}
        </div>
        {feedback}
      </div>
    )
  }

  return (
    <div className="graded">
      {fallbackNote}
      {!result ? (
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
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              e.stopPropagation()
              checkAnswer(true)
            }}
          />
          <button type="button" className="primary reveal" onClick={() => checkAnswer(false)}>
            Check <span className="hint">enter</span>
          </button>
        </>
      ) : (
        <>
          <LiveTypingMarks expected={expected} given={input} graded />
          {feedback}
        </>
      )}
    </div>
  )
}