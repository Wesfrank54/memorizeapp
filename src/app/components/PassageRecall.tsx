import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildPassagePracticeRounds,
  firstLetterCue,
  gradePassageChunk,
  PASSAGE_PASS_SCORE,
  selectBlanks,
  splitPassage,
} from '../../core/passage.ts'
import { LiveTypingMarks } from './LiveTypingMarks.tsx'
import { VerdictBanner } from './VerdictBanner.tsx'

const normWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '')

type Phase = 'study' | 'practice' | 'full' | 'finish'

/**
 * Fill-in-the-blank trainer for a passage: study → graduated practice rounds
 * (line-by-line with rising coverage, then cumulative chunks) → full passage recall.
 */
export function PassageRecall({
  text,
  coverage,
  variant = 0,
  fullRecall,
  onDone,
}: {
  text: string
  coverage: number
  variant?: number
  /** After practice rounds, require typing the full passage (default: multi-line text). */
  fullRecall?: boolean
  onDone: (score: number) => void
}) {
  const chunks = useMemo(() => splitPassage(text), [text])
  const wantsFullRecall = fullRecall ?? chunks.length > 1
  const chunkWordCounts = useMemo(
    () => chunks.map((c) => c.split(/\s+/).filter(Boolean).length),
    [chunks],
  )
  const rounds = useMemo(
    () => buildPassagePracticeRounds(coverage, chunkWordCounts, wantsFullRecall),
    [coverage, chunkWordCounts, wantsFullRecall],
  )

  const [phase, setPhase] = useState<Phase>('study')
  const [roundIdx, setRoundIdx] = useState(0)
  const [idx, setIdx] = useState(0)
  const [values, setValues] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)
  const [fullInput, setFullInput] = useState('')
  const [fullChecked, setFullChecked] = useState(false)
  const [finishScore, setFinishScore] = useState<number | null>(null)
  const currentRound = rounds[roundIdx]
  const isCumulative = currentRound?.kind === 'cumulative'

  const lineWords = useMemo(
    () => (chunks[idx] && !isCumulative ? chunks[idx].split(/\s+/).filter(Boolean) : []),
    [chunks, idx, isCumulative],
  )

  const cumulativeChunks = useMemo(() => {
    if (!isCumulative || !currentRound) return []
    const n = currentRound.lineCount ?? chunks.length
    return chunks.slice(0, n)
  }, [chunks, currentRound, isCumulative])

  const cumulativeWords = useMemo(() => {
    if (!isCumulative) return []
    return cumulativeChunks.flatMap((c) => c.split(/\s+/).filter(Boolean))
  }, [cumulativeChunks, isCumulative])

  const words = isCumulative ? cumulativeWords : lineWords
  const activeCoverage = currentRound?.coverage ?? coverage
  const blankBase = currentRound?.blankVariant ?? variant + roundIdx * 17
  const blankVariant = blankBase + (isCumulative ? 0 : idx)
  const blanks = useMemo(
    () => selectBlanks(words, activeCoverage, blankVariant),
    [words, activeCoverage, blankVariant],
  )

  const advancedRef = useRef(false)
  const nextRef = useRef<() => void>(() => {})
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => {
    advancedRef.current = false
  }, [idx, checked, fullChecked, roundIdx])

  useEffect(() => {
    if (phase !== 'practice' || !checked) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (advancedRef.current) return
      if (!linePasses()) return
      advancedRef.current = true
      nextRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, checked, values, words, blanks, roundIdx, idx, isCumulative])

  useEffect(() => {
    if (phase !== 'study') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      setPhase('practice')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  useEffect(() => {
    if (phase !== 'finish' || finishScore === null) return
    const score = finishScore
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      onDone(score)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, finishScore, onDone])

  function gradeLine(): { correct: number; total: number } {
    let correct = 0
    for (const i of blanks) if (normWord(values[i] ?? '') === normWord(words[i])) correct++
    return { correct, total: blanks.size }
  }

  function linePasses(): boolean {
    const g = gradeLine()
    return g.total === 0 || g.correct / g.total >= PASSAGE_PASS_SCORE
  }

  function finishPractice() {
    if (wantsFullRecall) setPhase('full')
    else {
      setFinishScore(1)
      setPhase('finish')
    }
  }

  function startNextRound() {
    setRoundIdx(roundIdx + 1)
    setIdx(0)
    setValues({})
    setChecked(false)
  }

  function nextStep() {
    if (!linePasses()) return

    if (isCumulative) {
      if (roundIdx + 1 < rounds.length) startNextRound()
      else finishPractice()
      return
    }

    if (idx + 1 < chunks.length) {
      setIdx(idx + 1)
      setValues({})
      setChecked(false)
      return
    }

    if (roundIdx + 1 < rounds.length) startNextRound()
    else finishPractice()
  }
  nextRef.current = nextStep

  function checkFull() {
    const { total, correct } = gradePassageChunk(text, fullInput)
    const score = total ? correct / total : 1
    setFinishScore(score)
    setFullChecked(true)
  }

  if (chunks.length === 0) {
    return (
      <button className="primary reveal" onClick={() => onDone(1)}>
        Continue
      </button>
    )
  }

  if (phase === 'study') {
    const roundHint =
      rounds.length > 1
        ? ` · ${rounds.length} practice rounds${wantsFullRecall ? ', then full passage' : ''}`
        : wantsFullRecall
          ? ' · then full passage'
          : ''
    return (
      <div className="graded">
        <div className="card-face answer passage-study">{text}</div>
        <p className="muted small">
          You&apos;ll practice in stages — easier blanks first, building up to the full recite{roundHint}.
        </p>
        <button className="primary reveal" onClick={() => setPhase('practice')}>
          I&apos;ve studied it — start recall <span className="hint">enter</span>
        </button>
      </div>
    )
  }

  if (phase === 'full') {
    const passed = finishScore !== null && finishScore >= PASSAGE_PASS_SCORE
    return (
      <div className="graded passage-recall passage-full">
        <p className="muted small passage-full-prompt">
          Final check — type the <strong>entire passage</strong> from memory, same words in order.
          {fullChecked ? null : (
            <span className="passage-live-hint"> Words turn <span className="w-ok">green</span> when right and{' '}
            <span className="w-no">red</span> when off.</span>
          )}
        </p>
        {!fullChecked ? (
          <>
            <LiveTypingMarks expected={text} given={fullInput} />
            <textarea
              className="passage-full-input"
              rows={Math.min(14, Math.max(4, chunks.length + 2))}
              placeholder="Type the full passage here…"
              value={fullInput}
              autoFocus
              onChange={(e) => setFullInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  checkFull()
                }
              }}
            />
            <button type="button" className="primary reveal" disabled={!fullInput.trim()} onClick={checkFull}>
              Check full passage
            </button>
          </>
        ) : (
          <>
            <LiveTypingMarks expected={text} given={fullInput} graded />
            <VerdictBanner
              correct={passed}
              detail={`${Math.round((finishScore ?? 0) * 100)}% of words correct`}
            />
            {passed ? (
              <button type="button" className="primary reveal" autoFocus onClick={() => onDone(finishScore!)}>
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="primary reveal"
                onClick={() => {
                  setFullChecked(false)
                  setFinishScore(null)
                }}
              >
                Try again
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  if (phase === 'finish' && finishScore !== null) {
    const pct = Math.round(finishScore * 100)
    const passed = finishScore >= PASSAGE_PASS_SCORE
    return (
      <div className="graded passage-recall">
        <VerdictBanner correct={passed} detail={`${pct}% of the full passage correct`} />
        <button className="primary reveal" autoFocus onClick={() => onDone(finishScore)}>
          Continue <span className="hint">enter</span>
        </button>
      </div>
    )
  }

  const firstBlank = blanks.size ? Math.min(...blanks) : -1
  const isFilled = (i: number) => normWord(values[i] ?? '') === normWord(words[i])
  const g = gradeLine()
  const lineOk = g.total === 0 || g.correct / g.total >= PASSAGE_PASS_SCORE

  function focusNextBlank(afterI: number, vals: Record<number, string>) {
    const isRight = (j: number) => normWord(vals[j] ?? '') === normWord(words[j])
    const order = [...blanks]
    const target = order.find((j) => j > afterI && !isRight(j)) ?? order.find((j) => j < afterI && !isRight(j))
    if (target === undefined) setChecked(true)
    else inputRefs.current[target]?.focus()
  }

  const isLastStep =
    isCumulative
      ? roundIdx + 1 >= rounds.length
      : idx + 1 >= chunks.length && roundIdx + 1 >= rounds.length

  const nextLabel = isLastStep
    ? wantsFullRecall
      ? 'Final — type full passage'
      : 'Finish'
    : isCumulative
      ? roundIdx + 1 < rounds.length
        ? `Next: ${rounds[roundIdx + 1].title}`
        : wantsFullRecall
          ? 'Final — type full passage'
          : 'Finish'
      : idx + 1 < chunks.length
        ? 'Next line'
        : `Next: ${rounds[roundIdx + 1]?.title ?? 'Continue'}`

  function renderWordInputs(wordList: string[], globalOffset: number) {
    return wordList.map((w, wi) => {
      const i = globalOffset + wi
      if (!blanks.has(i)) return <span key={i} className="w-context">{w} </span>
      if (checked) {
        const ok = normWord(values[i] ?? '') === normWord(w)
        return (
          <span key={i} className={ok ? 'w-ok' : 'w-no'}>
            {ok ? values[i] : w}{' '}
          </span>
        )
      }
      const right = isFilled(i)
      return (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el
          }}
          className={`blank-input${right ? ' correct' : ''}`}
          style={{ width: `${Math.max(4, w.length + 1)}ch` }}
          value={values[i] ?? ''}
          placeholder={firstLetterCue(w)}
          autoFocus={i === firstBlank}
          readOnly={right}
          tabIndex={right ? -1 : undefined}
          onChange={(e) => {
            const val = e.target.value
            setValues((v) => ({ ...v, [i]: val }))
            if (normWord(val) === normWord(w)) focusNextBlank(i, { ...values, [i]: val })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              setChecked(true)
            }
          }}
        />
      )
    })
  }

  let globalOffset = 0

  return (
    <div className="graded passage-recall">
      <div className="cp-progress">
        Round {roundIdx + 1} / {rounds.length} · {currentRound.title}
        {isCumulative ? null : (
          <span>
            {' '}
            · line {idx + 1} / {chunks.length}
          </span>
        )}
        {wantsFullRecall ? <span className="muted small"> · then full passage</span> : null}
      </div>

      <div className="passage-fill">
        {isCumulative
          ? cumulativeChunks.map((chunk, ci) => {
              const chunkWords = chunk.split(/\s+/).filter(Boolean)
              const block = renderWordInputs(chunkWords, globalOffset)
              globalOffset += chunkWords.length
              return (
                <div key={ci} className="passage-cumulative-line">
                  {block}
                </div>
              )
            })
          : renderWordInputs(words, 0)}
      </div>

      {!checked ? (
        <button className="primary reveal" onClick={() => setChecked(true)}>
          {isCumulative ? 'Check section' : 'Check line'}
        </button>
      ) : (
        <>
          <VerdictBanner
            correct={lineOk}
            detail={g.total > 0 ? `${g.correct}/${g.total} blanks correct` : undefined}
          />
          {lineOk ? (
            <button
              className="primary reveal"
              autoFocus
              onClick={() => {
                if (advancedRef.current) return
                advancedRef.current = true
                nextStep()
              }}
            >
              {nextLabel} <span className="hint">enter</span>
            </button>
          ) : (
            <button
              type="button"
              className="primary reveal"
              onClick={() => {
                setChecked(false)
                advancedRef.current = false
              }}
            >
              {isCumulative ? 'Try this section again' : 'Try this line again'}
            </button>
          )}
        </>
      )}
    </div>
  )
}