import { useMemo, useState } from 'react'
import type { AppState, Card, Note } from '../../core/types.ts'
import { renderContent } from '../../core/schedule.ts'
import {
  ensureImageDemoDeck,
  EXPECTED_IMAGE_CARDS,
  imageDemoItems,
  IMAGE_DEMO_DECK_NAME,
} from '../../core/image-demo.ts'
import { getState, recordQuizAttempt } from '../../core/store.ts'
import { GradedAnswer } from './GradedAnswer.tsx'
import { CardFace } from './CardFace.tsx'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface Session {
  queue: { card: Card; note: Note }[]
  index: number
  correct: number
}

export function ImageTestingBeta({ state }: { state: AppState }) {
  const [session, setSession] = useState<Session | null>(null)
  const [flash, setFlash] = useState('')
  const [loading, setLoading] = useState(false)

  const items = useMemo(() => imageDemoItems(state), [state])
  const ready = items.length >= 3

  function showFlash(message: string) {
    setFlash(message)
    window.setTimeout(() => setFlash(''), 4000)
  }

  async function loadDeck() {
    setLoading(true)
    try {
      const result = await ensureImageDemoDeck()
      if (result.added > 0) {
        showFlash(
          `Imported "${IMAGE_DEMO_DECK_NAME}" — ${result.cardsAdded} cards (${result.imageCards} image MCQ).`,
        )
      } else {
        showFlash('Demo deck already loaded — start a session.')
      }
    } catch (err) {
      showFlash(err instanceof Error ? err.message : 'Failed to load demo deck.')
    } finally {
      setLoading(false)
    }
  }

  async function start() {
    setLoading(true)
    try {
      await ensureImageDemoDeck()
      const fresh = imageDemoItems(getState())
      if (fresh.length < 3) {
        showFlash('Could not load enough image cards — try Load demo deck.')
        return
      }
      setSession({ queue: shuffle(fresh), index: 0, correct: 0 })
    } catch (err) {
      showFlash(err instanceof Error ? err.message : 'Failed to start session.')
    } finally {
      setLoading(false)
    }
  }

  if (!session) {
    return (
      <div className="panel form image-beta-panel">
        <h2 className="opt-title">Image Testing Beta</h2>
        <p className="muted small">
          Prototype: show a collar-device image and pick the matching rank (multiple choice). Images are cropped
          from the ODS Knowledge Book (PDF 26070) — no rank labels on the image itself.
        </p>
        <div className="image-beta-stats">
          <span>
            {items.length} / {EXPECTED_IMAGE_CARDS} image cards in &ldquo;{IMAGE_DEMO_DECK_NAME}&rdquo;
          </span>
          {!ready ? <span className="muted small">Need at least 3 for MCQ — load the demo deck.</span> : null}
        </div>
        {flash ? <p className="flash-ok">{flash}</p> : null}
        <div className="row image-beta-actions">
          <button type="button" className="primary" onClick={() => void loadDeck()} disabled={loading}>
            {loading ? 'Loading…' : items.length === 0 ? 'Load demo deck' : 'Refresh demo deck'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void start()}
            disabled={loading || (!ready && items.length === 0)}
          >
            {loading ? 'Loading…' : ready ? 'Start image MCQ' : 'Load deck & start'}
          </button>
        </div>
        {items.length > 0 ? (
          <div className="image-beta-preview">
            <div className="stat-label">Preview</div>
            <CardFace
              text={items[0]!.note.fields.front}
              imageUrl={renderContent(items[0]!.note, items[0]!.card).questionImage}
              imageAlt="Sample collar device"
            />
          </div>
        ) : null}
      </div>
    )
  }

  const current = session.queue[session.index]
  if (!current) {
    const total = session.queue.length
    const pct = total > 0 ? Math.round((session.correct / total) * 100) : 0
    return (
      <div className="panel center">
        <div className="cp-score">{pct}%</div>
        <p>
          {session.correct} / {total} correct
        </p>
        <button type="button" className="primary" onClick={() => setSession(null)}>
          Back to Image Testing Beta
        </button>
      </div>
    )
  }

  const { card, note } = current
  const content = renderContent(note, card)

  return (
    <div className="panel review image-beta-session">
      <div className="cp-progress">
        Image beta · {session.index + 1} / {session.queue.length}
      </div>
      <CardFace text={content.question} imageUrl={content.questionImage} imageAlt="Collar device" />
      <GradedAnswer
        key={card.id}
        state={state}
        card={card}
        note={note}
        mode="mcq"
        onGraded={(r) => {
          recordQuizAttempt(card.id, 'mcq', r.correct)
          setSession((s) => {
            if (!s) return s
            const next = s.index + 1
            return { ...s, index: next, correct: s.correct + (r.correct ? 1 : 0) }
          })
        }}
      />
      <button type="button" className="link skip-link" onClick={() => setSession(null)}>
        Exit session
      </button>
    </div>
  )
}