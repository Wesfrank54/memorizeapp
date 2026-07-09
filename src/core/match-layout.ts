import type { MatchCategory } from './match-challenges.ts'
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
  hintSize: number
  gapPx: number
  labelSize: number
  cardPadY: number
  cardPadX: number
  slotMinH: number
}

type MatchScaleTier = Omit<MatchBoardFit, 'slotCols' | 'poolCols'>

/** Collar device images — balance image size with rank cards. */
const COLLAR_SCALE_TIERS: MatchScaleTier[] = [
  {
    lineClamp: 2,
    insigniaH: 80,
    insigniaW: 96,
    hintClamp: 4,
    hintSize: 11,
    gapPx: 10,
    labelSize: 15,
    cardPadY: 11,
    cardPadX: 13,
    slotMinH: 56,
  },
  {
    lineClamp: 2,
    insigniaH: 68,
    insigniaW: 84,
    hintClamp: 3,
    hintSize: 10,
    gapPx: 8,
    labelSize: 14,
    cardPadY: 10,
    cardPadX: 12,
    slotMinH: 50,
  },
  {
    lineClamp: 2,
    insigniaH: 56,
    insigniaW: 72,
    hintClamp: 3,
    hintSize: 10,
    gapPx: 7,
    labelSize: 13,
    cardPadY: 9,
    cardPadX: 11,
    slotMinH: 44,
  },
  {
    lineClamp: 1,
    insigniaH: 44,
    insigniaW: 58,
    hintClamp: 2,
    hintSize: 9,
    gapPx: 5,
    labelSize: 12,
    cardPadY: 8,
    cardPadX: 10,
    slotMinH: 38,
  },
]

/** Sleeve descriptions — medium-length prose; between collar images and shoulder boards. */
const SLEEVE_SCALE_TIERS: MatchScaleTier[] = [
  {
    lineClamp: 2,
    insigniaH: 0,
    insigniaW: 140,
    hintClamp: 6,
    hintSize: 12,
    gapPx: 9,
    labelSize: 15,
    cardPadY: 10,
    cardPadX: 12,
    slotMinH: 54,
  },
  {
    lineClamp: 2,
    insigniaH: 0,
    insigniaW: 128,
    hintClamp: 5,
    hintSize: 11,
    gapPx: 8,
    labelSize: 14,
    cardPadY: 9,
    cardPadX: 11,
    slotMinH: 48,
  },
  {
    lineClamp: 2,
    insigniaH: 0,
    insigniaW: 116,
    hintClamp: 4,
    hintSize: 10,
    gapPx: 7,
    labelSize: 13,
    cardPadY: 8,
    cardPadX: 10,
    slotMinH: 42,
  },
]

/** Shoulder descriptions are long prose — prioritize readable text over density. */
const SHOULDER_SCALE_TIERS: MatchScaleTier[] = [
  {
    lineClamp: 3,
    insigniaH: 0,
    insigniaW: 200,
    hintClamp: 10,
    hintSize: 13,
    gapPx: 10,
    labelSize: 16,
    cardPadY: 12,
    cardPadX: 14,
    slotMinH: 62,
  },
  {
    lineClamp: 2,
    insigniaH: 0,
    insigniaW: 180,
    hintClamp: 8,
    hintSize: 12,
    gapPx: 8,
    labelSize: 14,
    cardPadY: 10,
    cardPadX: 12,
    slotMinH: 52,
  },
  {
    lineClamp: 2,
    insigniaH: 0,
    insigniaW: 160,
    hintClamp: 6,
    hintSize: 11,
    gapPx: 7,
    labelSize: 13,
    cardPadY: 9,
    cardPadX: 11,
    slotMinH: 46,
  },
]

function scaleTiers(category: MatchCategory): MatchScaleTier[] {
  if (category === 'shoulder') return SHOULDER_SCALE_TIERS
  if (category === 'sleeve') return SLEEVE_SCALE_TIERS
  return COLLAR_SCALE_TIERS
}

/** Match rows include insignia — fewer slot columns keeps cells wider and taller. */
export function matchLayoutProfile(items: OrderItem[], category: MatchCategory): OrderLayoutProfile {
  const n = items.length

  if (category === 'shoulder') {
    return {
      density: 'normal',
      lineClamp: 2,
      minCols: 2,
      maxCols: 2,
      maxPoolCols: 4,
      slotCols: 2,
      slotRows: Math.ceil(n / 2),
    }
  }

  const maxCols = category === 'sleeve' ? 4 : 5
  const slotCols = category === 'sleeve' ? 3 : 4

  return {
    density: 'normal',
    lineClamp: 2,
    minCols: 3,
    maxCols,
    maxPoolCols: maxCols + 2,
    slotCols,
    slotRows: Math.ceil(n / slotCols),
  }
}

export function applyMatchBoardLayout(board: HTMLElement, fit: MatchBoardFit, slotCount: number) {
  applyOrderBoardLayout(board, fit, slotCount)
  if (fit.insigniaH > 0) board.style.setProperty('--match-insignia-h', `${fit.insigniaH}px`)
  board.style.setProperty('--match-insignia-w', `${fit.insigniaW}px`)
  board.style.setProperty('--match-hint-clamp', String(fit.hintClamp))
  board.style.setProperty('--match-hint-size', `${fit.hintSize}px`)
  board.style.setProperty('--match-label-size', `${fit.labelSize}px`)
  board.style.setProperty('--match-card-pad', `${fit.cardPadY}px ${fit.cardPadX}px`)
  board.style.setProperty('--match-slot-min-h', `${fit.slotMinH}px`)
  board.style.setProperty('--order-gap', `${fit.gapPx}px`)
}

function matchListsFit(board: HTMLElement): boolean {
  if (board.clientHeight < 80) return false
  return orderListsFit(board)
}

/** Prefer the largest visual tier; within it use the most columns that still fit. */
export function fitMatchBoard(
  board: HTMLElement,
  slotCount: number,
  profile: OrderLayoutProfile,
  category: MatchCategory = 'collar',
): MatchBoardFit {
  const tiers = scaleTiers(category)
  const maxPool = profile.maxPoolCols ?? profile.maxCols
  let fallback: MatchBoardFit = {
    slotCols: profile.minCols,
    poolCols: profile.minCols,
    ...tiers[tiers.length - 1]!,
  }

  for (const tier of tiers) {
    let tierBest: MatchBoardFit | null = null
    for (let cols = profile.maxCols; cols >= profile.minCols; cols--) {
      for (let poolCols = Math.min(maxPool, cols + 2); poolCols >= cols; poolCols--) {
        const fit: MatchBoardFit = { slotCols: cols, poolCols, ...tier }
        applyMatchBoardLayout(board, fit, slotCount)
        if (matchListsFit(board)) tierBest = fit
        fallback = fit
      }
    }
    if (tierBest) return tierBest
  }

  applyMatchBoardLayout(board, fallback, slotCount)
  return fallback
}