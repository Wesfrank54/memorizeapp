import { useMemo, useState } from 'react'
import {
  allOrderSlotsFilled,
  correctOrderIds,
  gradeOrder,
  initOrderPlacement,
  ORDER_CHALLENGES,
  orderChallengeById,
  slotsToOrder,
  type OrderChallenge,
  type OrderGradeResult,
  type OrderSlotState,
} from '../../core/order-challenges.ts'
import { OrderSortList } from './OrderSortList.tsx'
import { VerdictBanner } from './VerdictBanner.tsx'

const CATEGORY_LABELS: Record<OrderChallenge['category'], string> = {
  'general-orders': 'General Orders',
  'chain-of-command': 'Chain of Command',
  ranks: 'Rank Structures',
}

export function OrderPractice() {
  const [challengeId, setChallengeId] = useState(ORDER_CHALLENGES[0]!.id)
  const [phase, setPhase] = useState<'pick' | 'active' | 'graded'>('pick')
  const [pool, setPool] = useState<string[]>([])
  const [slots, setSlots] = useState<OrderSlotState>([])
  const [grade, setGrade] = useState<OrderGradeResult | null>(null)
  const [attempts, setAttempts] = useState(0)

  const challenge = orderChallengeById(challengeId) ?? ORDER_CHALLENGES[0]!
  const itemsById = useMemo(() => new Map(challenge.items.map((i) => [i.id, i])), [challenge])
  const correctIds = useMemo(() => correctOrderIds(challenge), [challenge])
  const allFilled = allOrderSlotsFilled(slots)

  const grouped = useMemo(() => {
    const map = new Map<OrderChallenge['category'], OrderChallenge[]>()
    for (const c of ORDER_CHALLENGES) {
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
    const c = orderChallengeById(id)
    if (!c) return
    const placement = initOrderPlacement(correctOrderIds(c))
    setChallengeId(id)
    setPool(placement.pool)
    setSlots(placement.slots)
    setGrade(null)
    setAttempts(0)
    setPhase('active')
  }

  function checkOrder() {
    if (!allOrderSlotsFilled(slots)) return
    const result = gradeOrder(slotsToOrder(slots), correctIds)
    setGrade(result)
    setAttempts((a) => a + 1)
    setPhase('graded')
  }

  function reshuffle() {
    const placement = initOrderPlacement(correctIds)
    setPool(placement.pool)
    setSlots(placement.slots)
    setGrade(null)
    setPhase('active')
  }

  if (phase === 'pick') {
    return (
      <div className="panel form order-practice">
        <h2 className="opt-title">Order Practice</h2>
        <p className="muted small">
          Drag items from the options list into the correct numbered slots — General Orders (1–11), chain of command,
          rank structures, and more.
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
                    <span className="order-challenge-meta">{c.items.length} items</span>
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
    <div className="panel form order-practice">
      <div className="order-practice-head">
        <div>
          <h2 className="opt-title">{challenge.title}</h2>
          <p className="muted small">{challenge.description}</p>
        </div>
        <button type="button" className="link" onClick={() => setPhase('pick')}>
          ← All challenges
        </button>
      </div>

      <p className="order-instructions muted small">
        All options start on the left. Drag each one into the correct numbered box on the right (1st, 2nd, …). Drag
        back to the options list to change your answer.
      </p>

      <OrderSortList
        itemsById={itemsById}
        pool={pool}
        slots={slots}
        onChange={setPlacement}
        locked={phase === 'graded'}
        slotResults={grade?.correctPositions ?? null}
      />

      {phase === 'active' && !allFilled ? (
        <p className="muted small order-fill-hint">
          Fill all {challenge.items.length} slots before checking your order.
        </p>
      ) : null}

      {phase === 'graded' && grade ? (
        <>
          <VerdictBanner
            correct={grade.perfect}
            expected={
              grade.perfect
                ? undefined
                : `${grade.wrongCount} of ${challenge.items.length} out of place (${Math.round(grade.score * 100)}% correct slots)`
            }
          />
          {grade.perfect ? (
            <p className="flash-ok">
              Perfect order{attempts > 1 ? ` in ${attempts} attempt${attempts === 1 ? '' : 's'}` : ''}!
            </p>
          ) : null}
        </>
      ) : null}

      <div className="row order-practice-actions">
        {phase === 'active' ? (
          <>
            <button type="button" className="primary" onClick={checkOrder} disabled={!allFilled}>
              Check order
            </button>
            <button type="button" className="link" onClick={reshuffle}>
              Reshuffle
            </button>
          </>
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
              {grade?.perfect ? 'Practice again' : 'Try again'}
            </button>
            <button type="button" className="link" onClick={reshuffle}>
              New shuffle
            </button>
            {!grade?.perfect ? (
              <button
                type="button"
                className="link"
                onClick={() => {
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
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}