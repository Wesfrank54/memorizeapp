import { useMemo, useState } from 'react'
import type { AppState, Card, Note } from '../../core/types.ts'
import { CHECKPOINT_SIZE, gradeAnswer, sampleCheckpointCards } from '../../core/accountability.ts'
import { renderContent } from '../../core/schedule.ts'
import { recordCheckpoint } from '../../core/store.ts'
import { LiveTypingMarks } from './LiveTypingMarks.tsx'

/**
 * A proctored recall test: the user must type each answer from memory; the
 * system grades it. The resulting score is the *verified* number a retention
 * commitment resolves against — it can't be self-reported.
 */
export function CheckpointSession({
  state,
  deckId,
  deckLabel,
  onDone,
}: {
  state: AppState
  deckId: string | null
  deckLabel: string
  onDone: () => void
}) {
  const cards = useMemo(
    () => sampleCheckpointCards(state, deckId, CHECKPOINT_SIZE, (n: Note, c: Card) => renderContent(n, c).question),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [idx, setIdx] = useState(0)
  const [input, setInput] = useState('')
  const [graded, setGraded] = useState(false)
  const [results, setResults] = useState<boolean[]>([])
  const [done, setDone] = useState(false)

  if (cards.length === 0) {
    return (
      <div className="panel center">
        <p className="muted">No reviewed cards in {deckLabel} to test yet — review some first.</p>
        <button className="link" onClick={onDone}>
          back
        </button>
      </div>
    )
  }

  if (done) {
    const correct = results.filter(Boolean).length
    const pct = Math.round((correct / results.length) * 100)
    return (
      <div className="panel center">
        <div className="cp-score">{pct}%</div>
        <p>
          {correct} / {results.length} recalled
        </p>
        <p className="muted small">Recorded as a verified checkpoint for {deckLabel}.</p>
        <button className="primary" onClick={onDone}>
          done
        </button>
      </div>
    )
  }

  const cur = cards[idx]
  const lastCard = idx === cards.length - 1

  function submit() {
    setResults((r) => [...r, gradeAnswer(cur.expected, input)])
    setGraded(true)
  }
  function next(finalResults: boolean[]) {
    if (lastCard) {
      const correct = finalResults.filter(Boolean).length
      recordCheckpoint({
        deckId,
        sampledCardIds: cards.map((c) => c.card.id),
        correct,
        total: finalResults.length,
        score: finalResults.length ? correct / finalResults.length : 0,
      })
      setDone(true)
    } else {
      setIdx(idx + 1)
      setInput('')
      setGraded(false)
    }
  }
  const lastOk = results[results.length - 1]

  return (
    <div className="panel checkpoint">
      <div className="cp-progress">
        checkpoint · {deckLabel} · {idx + 1} / {cards.length}
      </div>
      <div className="card-face question">{cur.question}</div>

      {!graded ? (
        <>
          <p className="muted small typing-live-hint">
            Words turn <span className="w-ok">green</span> when right and <span className="w-no">red</span> when off.
          </p>
          <LiveTypingMarks expected={cur.expected} given={input} />
          <input
            className="cp-input"
            autoFocus
            value={input}
            placeholder="type the answer from memory…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="primary reveal" onClick={submit}>
            Submit
          </button>
        </>
      ) : (
        <>
          <LiveTypingMarks expected={cur.expected} given={input} graded />
          <div className={`cp-verdict ${lastOk ? 'ok' : 'no'}`}>
            {lastOk ? 'Correct ✓' : 'Incorrect'}
            {!lastOk && <span className="muted"> — answer: {cur.expected}</span>}
          </div>
          <button className="primary reveal" autoFocus onClick={() => next(results)}>
            {lastCard ? 'See score' : 'Next'}
          </button>
        </>
      )}
    </div>
  )
}
