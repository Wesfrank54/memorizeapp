import { useEffect, useMemo, useState } from 'react'
import {
  allOrderSlotsFilled,
  correctMatchIds,
  gradeOrder,
  initOrderPlacement,
  MATCH_CHALLENGES,
  matchChallengeById,
  matchPoolItems,
  slotsToOrder,
  type MatchChallenge,
  type OrderGradeResult,
  type OrderSlotState,
} from '../../core/match-challenges.ts'
import { MatchSortList } from './MatchSortList.tsx'
import { VerdictBanner } from './VerdictBanner.tsx'

const CATEGORY_LABELS: Record<MatchChallenge['category'], string> = {
  collar: 'Collar Devices',
  shoulder: 'Shoulder Boards',
}

export function MatchPractice() {
  const [challengeId, setChallengeId] = useState(MATCH_CHALLENGES[0]!.id)
  const [phase, setPhase] = useState<'pick' | 'active' | 'graded'>('pick')
  const [pool, setPool] = useState<string[]>([])
  const [slots, setSlots] = useState<OrderSlotState>([])
  const [grade, setGrade] = useState<OrderGradeResult | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [earnedPerfect, setEarnedPerfect] = useState(false)

  const challenge = matchChallengeById(challengeId) ?? MATCH_CHALLENGES[0]!
  const itemsById = useMemo(() => new Map(matchPoolItems(challenge).map((i) => [i.id, i])), [challenge])
  const correctIds = useMemo(() => correctMatchIds(challenge), [challenge])
  const allFilled = allOrderSlotsFilled(slots)

  const grouped = useMemo(() => {
    const map = new Map<MatchChallenge['category'], MatchChallenge[]>()
    for (const c of MATCH_CHALLENGES) {
      const list = map.get(c.category) ?? []
      list.push(c)
      map.set(c.category, list)
    }
    return map
  }, [])

  function setPlacement(nextPool: string[], nextSlots: OrderSlotState) {
    setPool(nextPool)
    setSlots(nextSlots)
  }

  function start(id = challengeId) {
    const c = matchChallengeById(id)
    if (!c) return
    const placement = initOrderPlacement(correctMatchIds(c))
    setChallengeId(id)
    setPool(placement.pool)
    setSlots(placement.slots)
    setGrade(null)
    setAttempts(0)
    setEarnedPerfect(false)
    setPhase('active')
  }

  function reshuffle(resetAttempts = false) {
    const placement = initOrderPlacement(correctIds)
    setPool(placement.pool)
    setSlots(placement.slots)
    setGrade(null)
    setPhase('active')
    setEarnedPerfect(false)
    if (resetAttempts) setAttempts(0)
  }

  function checkMatches() {
    if (!allOrderSlotsFilled(slots)) return
    const result = gradeOrder(slotsToOrder(slots), correctIds)
    setEarnedPerfect(result.perfect)
    setGrade(result)
    setAttempts((a) => a + 1)
    setPhase('graded')
  }

  const waitingForNextRound = phase === 'graded' && grade?.perfect === true && earnedPerfect

  useEffect(() => {
    if (!waitingForNextRound) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat) return
      e.preventDefault()
      reshuffle(true)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [waitingForNextRound, correctIds])

  if (phase === 'pick') {
    return (
      <div className="panel form match-practice">
        <h2 className="opt-title">Match beta</h2>
        <p className="muted small">
          Beta: drag rank names onto the correct collar device or shoulder board. Insignia stay fixed on the right —
          match each rank from the pool on the left.
        </p>
        {[...grouped.entries()].map(([cat, list]) => (
          <div key={cat} className="order-challenge-group">
            <div className="stat-label">{CATEGORY_LABELS[cat]}</div>
            <ul className="order-challenge-pick-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" className="order-challenge-card" onClick={() => start(c.id)}>
                    <span className="order-challenge-title">{c.title}</span>
                    <span className="muted small">{c.description}</span>
                    <span className="order-challenge-meta">{c.pairs.length} ranks</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="panel form order-practice order-practice--session match-practice--session">
      <div className="order-practice-head order-practice-head--compact">
        <div>
          <h2 className="opt-title">{challenge.title}</h2>
          <p className="muted small">{challenge.description}</p>
        </div>
        <button type="button" className="link" onClick={() => setPhase('pick')}>
          ← All challenges
        </button>
      </div>

      <div className="order-session-body">
        <MatchSortList
          pairs={challenge.pairs}
          category={challenge.category}
          itemsById={itemsById}
          pool={pool}
          slots={slots}
          onChange={setPlacement}
          locked={phase === 'graded'}
          slotResults={grade?.correctPositions ?? null}
        />
      </div>

      <div className="order-session-footer">
        {phase === 'active' && !allFilled ? (
          <p className="muted small order-fill-hint">
            Match all {challenge.pairs.length} ranks before checking.
          </p>
        ) : null}

        {phase === 'graded' && grade ? (
          <div className="order-session-verdict">
            <VerdictBanner
              correct={grade.perfect}
              expected={
                grade.perfect
                  ? undefined
                  : `${grade.wrongCount} of ${challenge.pairs.length} incorrect (${Math.round(grade.score * 100)}% correct)`
              }
            />
            {grade.perfect ? (
              <p className="flash-ok order-perfect-msg">
                Perfect match{attempts > 1 ? ` in ${attempts} attempt${attempts === 1 ? '' : 's'}` : ''}!
                {waitingForNextRound ? ' Press Enter for a new shuffle.' : ''}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="row order-practice-actions">
          {phase === 'active' ? (
            <>
              <button type="button" className="primary" onClick={checkMatches} disabled={!allFilled}>
                Check matches
              </button>
              <button type="button" className="link" onClick={() => reshuffle()}>
                Reshuffle
              </button>
            </>
          ) : waitingForNextRound ? (
            <button type="button" className="primary" onClick={() => reshuffle(true)}>
              Next round (Enter)
            </button>
          ) : grade?.perfect ? (
            <button type="button" className="link" onClick={() => reshuffle()}>
              New shuffle
            </button>
          ) : (
            <>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setGrade(null)
                  setPhase('active')
                }}
              >
                Try again
              </button>
              <button type="button" className="link" onClick={() => reshuffle()}>
                New shuffle
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEarnedPerfect(false)
                  setPool([])
                  setSlots([...correctIds])
                  setGrade({
                    perfect: true,
                    score: 1,
                    correctPositions: correctIds.map(() => true),
                    wrongCount: 0,
                  })
                  setPhase('graded')
                }}
              >
                Show solution
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}