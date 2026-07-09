import type { OrderItem } from './order-challenges.ts'
import { orderLayoutProfile, type OrderLayoutProfile } from './order-layout.ts'

/** Match rows include insignia — favor more columns on collar; fewer on shoulder text. */
export function matchLayoutProfile(
  items: OrderItem[],
  category: 'collar' | 'shoulder',
): OrderLayoutProfile {
  const n = items.length
  const base = orderLayoutProfile(items)

  if (category === 'shoulder') {
    const slotCols = 2
    return {
      density: 'compact',
      lineClamp: 2,
      minCols: 2,
      maxCols: 3,
      slotCols,
      slotRows: Math.ceil(n / slotCols),
    }
  }

  const slotCols = Math.max(3, base.slotCols)
  return {
    density: 'compact',
    lineClamp: 2,
    minCols: 3,
    maxCols: 5,
    slotCols,
    slotRows: Math.ceil(n / slotCols),
  }
}