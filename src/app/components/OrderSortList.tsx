import { useMemo, useState, type CSSProperties } from 'react'
import type { OrderDragSource, OrderItem, OrderSlotState } from '../../core/order-challenges.ts'
import { placeOrderItem, returnOrderItemToPool } from '../../core/order-challenges.ts'
import { orderLayoutProfile } from '../../core/order-layout.ts'
import { useOrderBoardFit } from './useOrderBoardFit.ts'

type DragState = { id: string; source: OrderDragSource } | null

function OrderCard({
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
      className={['order-sort-row', 'order-card', dragging ? 'order-dragging' : ''].filter(Boolean).join(' ')}
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

export function OrderSortList({
  itemsById,
  pool,
  slots,
  onChange,
  locked = false,
  slotResults,
}: {
  itemsById: Map<string, OrderItem>
  pool: string[]
  slots: OrderSlotState
  onChange: (pool: string[], slots: OrderSlotState) => void
  locked?: boolean
  /** Per-slot correctness after grading (same length as slots). */
  slotResults?: boolean[] | null
}) {
  const [drag, setDrag] = useState<DragState>(null)
  const [overSlot, setOverSlot] = useState<number | null>(null)
  const [overPool, setOverPool] = useState(false)
  const items = useMemo(() => [...itemsById.values()], [itemsById])
  const profile = useMemo(() => orderLayoutProfile(items), [items])
  const resetKey = `${slots.length}:${[...pool].join(',')}:${locked}`
  const { boardRef, fit } = useOrderBoardFit(profile, slots.length, resetKey)
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
      className="order-board"
      data-density={profile.density}
      data-cols={cols}
      style={boardStyle}
    >
      <section className="order-pool-panel">
        <h3 className="order-panel-title">Options</h3>
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
            <li className="order-pool-empty muted small">All placed</li>
          ) : (
            pool.map((id) => {
              const row = itemsById.get(id)
              if (!row) return null
              return (
                <li key={id} className="order-pool-item">
                  <OrderCard
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

      <section className="order-slots-panel">
        <h3 className="order-panel-title">Your order</h3>
        <ol className="order-slots-list order-slots-list--fit">
          {slots.map((id, index) => {
            const row = id ? itemsById.get(id) : null
            const slotOk = slotResults?.[index]
            const slotClass = [
              'order-slot',
              id ? 'order-slot-filled' : 'order-slot-empty',
              locked && slotResults && id ? (slotOk ? 'order-slot-ok' : 'order-slot-bad') : '',
              overSlot === index && drag ? 'order-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <li key={index} className="order-slot-row">
                <span className="order-slot-num" title={`Position ${index + 1}`}>
                  {index + 1}
                </span>
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
                    <OrderCard
                      row={row}
                      draggable={!locked}
                      dragging={drag?.id === id}
                      onDragStart={() => setDrag({ id: id!, source: { kind: 'slot', index } })}
                      onDragEnd={clearDrag}
                    />
                  ) : (
                    <span className="order-slot-placeholder">Drop</span>
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