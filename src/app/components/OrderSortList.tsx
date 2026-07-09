import { useState, type CSSProperties } from 'react'
import type { OrderDragSource, OrderItem, OrderSlotState } from '../../core/order-challenges.ts'
import { placeOrderItem, returnOrderItemToPool } from '../../core/order-challenges.ts'

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

  const splitLayout = slots.length >= 6
  const slotRows = Math.ceil(slots.length / 2)
  const slotRows3 = Math.ceil(slots.length / 3)
  const slotRows4 = Math.ceil(slots.length / 4)

  return (
    <div className="order-board">
      <section className="order-pool-panel">
        <h3 className="order-panel-title">Options</h3>
        <ul
          className={[
            'order-pool-list',
            splitLayout ? 'order-pool-list--split' : '',
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
            <li className="order-pool-empty muted small">All items placed</li>
          ) : (
            pool.map((id) => {
              const row = itemsById.get(id)
              if (!row) return null
              return (
                <li key={id}>
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
        <ol
          className={['order-slots-list', splitLayout ? 'order-slots-list--split' : ''].filter(Boolean).join(' ')}
          style={
            splitLayout
              ? ({
                  '--order-slot-rows': slotRows,
                  '--order-slot-rows-3': slotRows3,
                  '--order-slot-rows-4': slotRows4,
                } as CSSProperties)
              : undefined
          }
        >
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
                    <span className="order-slot-placeholder">Drop here</span>
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