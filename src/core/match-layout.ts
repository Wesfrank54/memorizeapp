import type { OrderItem } from './order-challenges.ts'
import {
  applyOrderBoardLayout,
  orderListsFit,
  type OrderLayoutProfile,
} from './order-layout.ts'

export interface MatchBoardFit {
  slotCols: number
  poolCols: number
  lineClamp: number
  insigniaH: number
  insigniaW: number
  hintClamp: number
  gapPx: number
}

const MATCH_SCALE_TIERS: Omit<MatchBoardFit, 'slotCols' | 'poolCols'>[] = [
  { lineClamp: 2, insigniaH: 44, insigniaW: 58, hintClamp: 3, gapPx: 5 },
  { lineClamp: 1, insigniaH: 34, insigniaW: 46, hintClamp: 2, gapPx: 4 },
  { lineClamp: 1, insigniaH: 26, insigniaW: 38, hintClamp: 2, gapPx: 3 },
]

/** Match rows include insignia — pack into many columns; pool can be denser than slots. */
export function matchLayoutProfile(
  items: OrderItem[],
  category: 'collar' | 'shoulder',
): OrderLayoutProfile {
  const n = items.length

  if (category === 'shoulder') {
    return {
      density: 'compact',
      lineClamp: 2,
      minCols: 2,
      maxCols: 4,
      maxPoolCols: 6,
      slotCols: 3,
      slotRows: Math.ceil(n / 3),
    }
  }

  return {
    density: 'compact',
    lineClamp: 2,
    minCols: 4,
    maxCols: 7,
    maxPoolCols: 9,
    slotCols: 5,
    slotRows: Math.ceil(n / 5),
  }
}

export function applyMatchBoardLayout(board: HTMLElement, fit: MatchBoardFit, slotCount: number) {
  applyOrderBoardLayout(board, fit, slotCount)
  board.style.setProperty('--match-insignia-h', `${fit.insigniaH}px`)
  board.style.setProperty('--match-insignia-w', `${fit.insigniaW}px`)
  board.style.setProperty('--match-hint-clamp', String(fit.hintClamp))
  board.style.setProperty('--order-gap', `${fit.gapPx}px`)
}

function matchListsFit(board: HTMLElement): boolean {
  if (board.clientHeight < 80) return false
  return orderListsFit(board)
}

/** Prefer the most columns + tightest scale tier that fits the viewport. */
export function fitMatchBoard(
  board: HTMLElement,
  slotCount: number,
  profile: OrderLayoutProfile,
): MatchBoardFit {
  const maxPool = profile.maxPoolCols ?? profile.maxCols
  let fallback: MatchBoardFit = {
    slotCols: profile.maxCols,
    poolCols: maxPool,
    ...MATCH_SCALE_TIERS[MATCH_SCALE_TIERS.length - 1]!,
  }

  for (const tier of MATCH_SCALE_TIERS) {
    for (let cols = profile.maxCols; cols >= profile.minCols; cols--) {
      for (let poolCols = Math.min(maxPool, cols + 2); poolCols >= cols; poolCols--) {
        const fit: MatchBoardFit = { slotCols: cols, poolCols, ...tier }
        applyMatchBoardLayout(board, fit, slotCount)
        if (matchListsFit(board)) return fit
        fallback = fit
      }
    }
  }

  applyMatchBoardLayout(board, fallback, slotCount)
  return fallback
}