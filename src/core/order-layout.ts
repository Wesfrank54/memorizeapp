import type { OrderItem } from './order-challenges.ts'

export type OrderLayoutDensity = 'ultra' | 'compact' | 'normal'

export interface OrderLayoutProfile {
  density: OrderLayoutDensity
  lineClamp: number
  minCols: number
  maxCols: number
  /** Pool can use more columns than slots when cards are narrower than slot rows. */
  maxPoolCols?: number
  slotCols: number
  slotRows: number
}

/** Heuristic layout for a challenge — columns/density scale with count and text length. */
export function orderLayoutProfile(items: OrderItem[]): OrderLayoutProfile {
  const n = items.length
  const maxLabel = items.reduce((m, i) => Math.max(m, i.label.length), 0)
  const longText = maxLabel > 72 || items.some((i) => i.label.length > 110)

  let density: OrderLayoutDensity = 'normal'
  let lineClamp = 3
  if (longText) {
    density = 'ultra'
    lineClamp = 3
  } else if (n >= 12 || maxLabel > 48) {
    density = 'compact'
    lineClamp = 3
  }

  let slotCols = 2
  if (n >= 8) slotCols = 3
  if (n >= 12) slotCols = 4
  if (n >= 15) slotCols = 4
  if (longText && n >= 10) slotCols = Math.max(slotCols, 3)

  const maxCols = longText ? 7 : n >= 14 ? 6 : n >= 10 ? 5 : 4

  return {
    density,
    lineClamp,
    minCols: slotCols,
    maxCols,
    slotCols,
    slotRows: Math.ceil(n / slotCols),
  }
}

export interface OrderBoardFit {
  slotCols: number
  poolCols: number
  lineClamp: number
}

export function applyOrderBoardLayout(
  board: HTMLElement,
  fit: Pick<OrderBoardFit, 'slotCols' | 'poolCols' | 'lineClamp'>,
  slotCount: number,
) {
  const rows = Math.ceil(slotCount / fit.slotCols)
  board.style.setProperty('--order-slot-cols', String(fit.slotCols))
  board.style.setProperty('--order-pool-cols', String(fit.poolCols))
  board.style.setProperty('--order-slot-rows', String(rows))
  board.style.setProperty('--order-line-clamp', String(fit.lineClamp))
}

/** True when both pool and slot lists fit inside their panels (no scroll). */
export function orderListsFit(board: HTMLElement): boolean {
  if (board.clientHeight < 80) return false
  const pool = board.querySelector<HTMLElement>('.order-pool-list')
  const slots = board.querySelector<HTMLElement>('.order-slots-list')
  const tol = 2
  const poolOk = !pool || (pool.clientHeight >= 40 && pool.scrollHeight <= pool.clientHeight + tol)
  const slotsOk = !slots || (slots.clientHeight >= 40 && slots.scrollHeight <= slots.clientHeight + tol)
  return poolOk && slotsOk
}

/** Auto-fit column count per deck + viewport; prefer the most columns that still fit. */
export function fitOrderBoard(
  board: HTMLElement,
  slotCount: number,
  profile: OrderLayoutProfile,
): OrderBoardFit {
  const lineClamp = profile.lineClamp
  const maxPool = profile.maxPoolCols ?? profile.maxCols
  let fallback: OrderBoardFit = {
    slotCols: profile.maxCols,
    poolCols: maxPool,
    lineClamp,
  }
  let bestFit: OrderBoardFit | null = null

  for (let cols = profile.minCols; cols <= profile.maxCols; cols++) {
    for (let poolCols = cols; poolCols <= maxPool; poolCols++) {
      const fit = { slotCols: cols, poolCols, lineClamp }
      applyOrderBoardLayout(board, fit, slotCount)
      if (orderListsFit(board)) bestFit = fit
      fallback = fit
    }
  }

  const chosen = bestFit ?? fallback
  applyOrderBoardLayout(board, chosen, slotCount)
  return chosen
}

/** @deprecated Use fitOrderBoard — kept for tests that only need column count. */
export function fitOrderBoardColumns(
  board: HTMLElement,
  slotCount: number,
  minCols: number,
  maxCols: number,
): number {
  const profile: OrderLayoutProfile = {
    density: 'normal',
    lineClamp: 2,
    minCols,
    maxCols,
    slotCols: minCols,
    slotRows: Math.ceil(slotCount / minCols),
  }
  return fitOrderBoard(board, slotCount, profile).slotCols
}