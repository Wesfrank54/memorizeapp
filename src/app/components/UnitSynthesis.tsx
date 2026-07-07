import { useMemo, useState } from 'react'
import { PASSAGE_PASS_SCORE } from '../../core/passage.ts'
import { buildUnitSynthesis, gradeUnitSynthesis } from '../../core/unit-synthesis.ts'
import type { SynthesisPartResult, UnitSynthesisPart } from '../../core/unit-synthesis.ts'
import type { AppState } from '../../core/types.ts'
import type { Unit } from '../../core/learn.ts'
import { LiveTypingMarks } from './LiveTypingMarks.tsx'
import { PassageRecall } from './PassageRecall.tsx'
import { VerdictBanner } from './VerdictBanner.tsx'

export function UnitSynthesis({
  state,
  unit,
  coverage,
  onSubmit,
}: {
  state: AppState
  unit: Unit
  coverage: number
  onSubmit: (results: SynthesisPartResult[]) => void
}) {
  const parts = useMemo(() => buildUnitSynthesis(state, unit), [state, unit])
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [partResults, setPartResults] = useState<Record<string, { passed: boolean; detail?: string }>>({})

  if (!parts) {
    return (
      <button type="button" className="primary" onClick={() => onSubmit([])}>
        Continue
      </button>
    )
  }

  function gradePart(part: UnitSynthesisPart) {
    if (part.style === 'typed') {
      const g = gradeUnitSynthesis([part], { [part.cardId]: responses[part.cardId] ?? '' })[0]
      setPartResults((prev) => ({ ...prev, [part.cardId]: { passed: g.passed } }))
      return
    }
  }

  const allGraded = parts.every((p) => partResults[p.cardId] !== undefined)
  const allPassed = allGraded && parts.every((p) => partResults[p.cardId]?.passed)
  const failed = parts.filter((p) => partResults[p.cardId] && !partResults[p.cardId]!.passed)

  function finish() {
    onSubmit(parts!.map((p) => ({ cardId: p.cardId, passed: partResults[p.cardId]?.passed ?? false })))
  }

  return (
    <div className="unit-synthesis">
      <p className="muted small synthesis-intro">
        Recall every section of <strong>{unit.label}</strong> from memory. You&apos;ll see right or wrong after each
        section. Miss any part and you&apos;ll drill those before retrying the full test.
      </p>
      <ol className="synthesis-parts">
        {parts.map((part, i) => {
          const result = partResults[part.cardId]
          return (
            <li
              key={part.cardId}
              className={`synthesis-part${result ? (result.passed ? ' ok' : ' miss') : ''}`}
            >
              <div className="synthesis-part-head">
                <span className="synthesis-part-num">{i + 1}</span>
                <span className="synthesis-part-label">{part.label}</span>
                {result ? (
                  <span className={`synthesis-mark${result.passed ? ' ok' : ' miss'}`}>
                    {result.passed ? '✓' : '✗'}
                  </span>
                ) : null}
              </div>
              {part.style === 'passage' ? (
                partResults[part.cardId] ? (
                  <VerdictBanner
                    correct={result!.passed}
                    detail={result!.detail}
                    expected={!result!.passed ? part.text.slice(0, 120) + (part.text.length > 120 ? '…' : '') : undefined}
                  />
                ) : (
                  <PassageRecall
                    key={part.cardId}
                    text={part.text}
                    coverage={coverage}
                    onDone={(score) => {
                      const passed = score >= PASSAGE_PASS_SCORE
                      setPartResults((prev) => ({
                        ...prev,
                        [part.cardId]: {
                          passed,
                          detail: `${Math.round(score * 100)}% of blanks correct`,
                        },
                      }))
                    }}
                  />
                )
              ) : (
                <>
                  {!result ? (
                    <p className="muted small typing-live-hint">
                      Words turn <span className="w-ok">green</span> when right and{' '}
                      <span className="w-no">red</span> when off.
                    </p>
                  ) : null}
                  <LiveTypingMarks
                    expected={part.text}
                    given={responses[part.cardId] ?? ''}
                    graded={!!result}
                  />
                  <textarea
                    className="synthesis-input"
                    rows={3}
                    placeholder="Type this section from memory…"
                    value={responses[part.cardId] ?? ''}
                    disabled={!!result}
                    onChange={(e) =>
                      setResponses((prev) => ({ ...prev, [part.cardId]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !result) {
                        e.preventDefault()
                        gradePart(part)
                      }
                    }}
                  />
                  {!result ? (
                    <button
                      type="button"
                      className="primary synthesis-check"
                      disabled={!(responses[part.cardId] ?? '').trim()}
                      onClick={() => gradePart(part)}
                    >
                      Check section
                    </button>
                  ) : (
                    <VerdictBanner
                      correct={result.passed}
                      expected={!result.passed ? part.text : undefined}
                    />
                  )}
                </>
              )}
            </li>
          )
        })}
      </ol>
      {allGraded ? (
        allPassed ? (
          <div className="synthesis-result pass">
            <VerdictBanner correct detail="All sections correct" />
            <button type="button" className="primary" onClick={finish}>
              Continue
            </button>
          </div>
        ) : (
          <div className="synthesis-result fail">
            <VerdictBanner
              correct={false}
              detail={`${failed.length} section${failed.length === 1 ? '' : 's'} need work: ${failed.map((f) => f.label).join(', ')}`}
            />
            <button type="button" className="primary" onClick={finish}>
              Practice missed parts
            </button>
          </div>
        )
      ) : (
        <p className="muted small">Check each section to continue.</p>
      )}
    </div>
  )
}