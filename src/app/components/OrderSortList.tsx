import { useState } from 'react'
import type { OrderItem } from '../../core/order-challenges.ts'
import { moveOrderId } from '../../core/order-challenges.ts'

export function OrderSortList({
  itemsById,
  order,
  onChange,
  locked = false,
  slotResults,
}: {
  itemsById: Map<string, OrderItem>
  order: string[]
  onChange: (next: string[]) => void
  locked?: boolean
  /** Per-slot correctness after grading (same length as order). */
  slotResults?: boolean[] | null
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  function move(id: string, dir: -1 | 1) {
    if (locked) return
    const from = order.indexOf(id)
    const to = from + dir
    if (from < 0 || to < 0 || to >= order.length) return
    onChange(moveOrderId(order, from, to))
  }

  function onDrop(targetIndex: number) {
    if (locked || !dragId) return
    const from = order.indexOf(dragId)
    if (from < 0) return
    onChange(moveOrderId(order, from, targetIndex))
    setDragId(null)
    setOverIndex(null)
  }

  return (
    <ol className="order-sort-list">
      {order.map((id, index) => {
        const row = itemsById.get(id)
        if (!row) return null
        const slotOk = slotResults?.[index]
        const rowClass = [
          'order-sort-row',
          locked && slotResults ? (slotOk ? 'order-slot-ok' : 'order-slot-bad') : '',
          dragId === id ? 'order-dragging' : '',
          overIndex === index && dragId ? 'order-drop-target' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <li
            key={id}
            className={rowClass}
            draggable={!locked}
            onDragStart={() => {
              if (locked) return
              setDragId(id)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverIndex(null)
            }}
            onDragOver={(e) => {
              if (locked || !dragId) return
              e.preventDefault()
              setOverIndex(index)
            }}
            onDrop={(e) => {
              e.preventDefault()
              onDrop(index)
            }}
          >
            <span className="order-slot-num" title="Your position in the list">
              {index + 1}
            </span>
            <div className="order-row-body">
              <div className="order-row-label">{row.label}</div>
              {row.detail ? <div className="order-row-detail">{row.detail}</div> : null}
            </div>
            {!locked ? (
              <div className="order-row-actions">
                <button type="button" className="link order-nudge" onClick={() => move(id, -1)} disabled={index === 0} aria-label="Move up">
                  ▲
                </button>
                <button
                  type="button"
                  className="link order-nudge"
                  onClick={() => move(id, 1)}
                  disabled={index === order.length - 1}
                  aria-label="Move down"
                >
                  ▼
                </button>
                <span className="order-drag-hint" aria-hidden>
                  ⠿
                </span>
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}