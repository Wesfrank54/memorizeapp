import { useMemo, useState, type CSSProperties } from 'react'
import type { MatchCategory, MatchPair } from '../../core/match-challenges.ts'
import {
  placeOrderItem,
  returnOrderItemToPool,
  type OrderDragSource,
  type OrderItem,
  type OrderSlotState,
} from '../../core/match-challenges.ts'
import { matchLayoutProfile } from '../../core/match-layout.ts'
import { useMatchBoardFit } from './useMatchBoardFit.ts'

type DragState = { id: string; source: OrderDragSource } | null

function RankCard({
  row,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  row: OrderItem
  draggable: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      className={['order-sort-row', 'order-card', 'match-rank-card', dragging ? 'order-dragging' : '']
        .filter(Boolean)
        .join(' ')}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <div className="order-row-body">
        <div className="order-row-label" title={row.label}>
          {row.label}
        </div>
        {row.detail ? <div className="order-row-detail">{row.detail}</div> : null}
      </div>
      {draggable ? (
        <span className="order-drag-hint" aria-hidden>
          ⠿
        </span>
      ) : null}
    </div>
  )
}

function InsigniaCard({ pair, index }: { pair: MatchPair; index: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = pair.imageUrl && !imgFailed

  return (
    <div className="match-insignia-card">
      <div className="match-insignia-index" aria-hidden>
        {index + 1}
      </div>
      {showImage ? (
        <figure className="match-insignia-media">
          <img
            src={pair.imageUrl}
            alt={`Insignia for ${pair.rankCode}`}
            className="match-insignia-img"
            onError={() => setImgFailed(true)}
          />
        </figure>
      ) : (
        <p className="match-insignia-hint" title={pair.insigniaHint}>
          {pair.insigniaHint}
        </p>
      )}
    </div>
  )
}

export function MatchSortList({
  pairs,
  category,
  itemsById,
  pool,
  slots,
  onChange,
  locked = false,
  slotResults,
}: {
  pairs: MatchPair[]
  category: MatchCategory
  itemsById: Map<string, OrderItem>
  pool: string[]
  slots: OrderSlotState
  onChange: (pool: string[], slots: OrderSlotState) => void
  locked?: boolean
  slotResults?: boolean[] | null
}) {
  const [drag, setDrag] = useState<DragState>(null)
  const [overSlot, setOverSlot] = useState<number | null>(null)
  const [overPool, setOverPool] = useState(false)

  const items = useMemo(() => [...itemsById.values()], [itemsById])
  const profile = useMemo(() => matchLayoutProfile(items, category), [items, category])
  const resetKey = `${category}:${slots.length}:${[...pool].join(',')}:${locked}`
  const { boardRef, fit } = useMatchBoardFit(profile, slots.length, resetKey, category)
  const cols = fit.slotCols

  function clearDrag() {
    setDrag(null)
    setOverSlot(null)
    setOverPool(false)
  }

  function dropOnSlot(targetIndex: number) {
    if (locked || !drag) return
    const next = placeOrderItem(pool, slots, drag.source, drag.id, targetIndex)
    onChange(next.pool, next.slots)
    clearDrag()
  }

  function dropOnPool() {
    if (locked || !drag || drag.source.kind !== 'slot') return
    const next = returnOrderItemToPool(pool, slots, drag.source.index)
    onChange(next.pool, next.slots)
    clearDrag()
  }

  const boardStyle = {
    '--order-slot-cols': cols,
    '--order-pool-cols': fit.poolCols,
    '--order-slot-rows': Math.ceil(slots.length / cols),
    '--order-line-clamp': fit.lineClamp,
  } as CSSProperties

  return (
    <div
      ref={boardRef}
      className="order-board match-board"
      data-density={profile.density}
      data-match={category}
      data-cols={cols}
      style={boardStyle}
    >
      <section className="order-pool-panel match-pool-panel">
        <h3 className="order-panel-title">Ranks</h3>
        <ul
          className={[
            'order-pool-list',
            'order-pool-list--fit',
            overPool && drag?.source.kind === 'slot' ? 'order-drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onDragOver={(e) => {
            if (locked || drag?.source.kind !== 'slot') return
            e.preventDefault()
            setOverPool(true)
            setOverSlot(null)
          }}
          onDragLeave={() => setOverPool(false)}
          onDrop={(e) => {
            e.preventDefault()
            dropOnPool()
          }}
        >
          {pool.length === 0 ? (
            <li className="order-pool-empty muted small">All matched</li>
          ) : (
            pool.map((id) => {
              const row = itemsById.get(id)
              if (!row) return null
              return (
                <li key={id} className="order-pool-item">
                  <RankCard
                    row={row}
                    draggable={!locked}
                    dragging={drag?.id === id}
                    onDragStart={() => setDrag({ id, source: { kind: 'pool' } })}
                    onDragEnd={clearDrag}
                  />
                </li>
              )
            })
          )}
        </ul>
      </section>

      <section className="order-slots-panel match-slots-panel">
        <h3 className="order-panel-title">Match to insignia</h3>
        <ol className="order-slots-list order-slots-list--fit match-slots-list">
          {slots.map((id, index) => {
            const pair = pairs[index]
            const row = id ? itemsById.get(id) : null
            const slotOk = slotResults?.[index]
            const slotClass = [
              'order-slot',
              'match-rank-slot',
              id ? 'order-slot-filled' : 'order-slot-empty',
              locked && slotResults && id ? (slotOk ? 'order-slot-ok' : 'order-slot-bad') : '',
              overSlot === index && drag ? 'order-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')

            if (!pair) return null

            return (
              <li key={pair.id} className="order-slot-row match-slot-row">
                <InsigniaCard pair={pair} index={index} />
                <div
                  className={slotClass}
                  onDragOver={(e) => {
                    if (locked || !drag) return
                    e.preventDefault()
                    setOverSlot(index)
                    setOverPool(false)
                  }}
                  onDragLeave={() => setOverSlot((prev) => (prev === index ? null : prev))}
                  onDrop={(e) => {
                    e.preventDefault()
                    dropOnSlot(index)
                  }}
                >
                  {row ? (
                    <RankCard
                      row={row}
                      draggable={!locked}
                      dragging={drag?.id === id}
                      onDragStart={() => setDrag({ id: id!, source: { kind: 'slot', index } })}
                      onDragEnd={clearDrag}
                    />
                  ) : (
                    <span className="order-slot-placeholder">Drop rank</span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}