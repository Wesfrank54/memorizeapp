import { useLayoutEffect, useRef, useState } from 'react'
import type { MatchCategory } from '../../core/match-challenges.ts'
import {
  fitMatchBoard,
  type MatchBoardFit,
} from '../../core/match-layout.ts'
import type { OrderLayoutProfile } from '../../core/order-layout.ts'

export function useMatchBoardFit(
  profile: OrderLayoutProfile,
  slotCount: number,
  resetKey: string,
  category: MatchCategory,
) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<MatchBoardFit>(() => {
    if (category === 'shoulder') {
      return {
        slotCols: profile.slotCols,
        poolCols: profile.maxPoolCols ?? profile.slotCols,
        lineClamp: profile.lineClamp,
        insigniaH: 0,
        insigniaW: 200,
        hintClamp: 10,
        hintSize: 13,
        gapPx: 10,
        labelSize: 15,
        cardPadY: 11,
        cardPadX: 13,
        slotMinH: 58,
      }
    }
    if (category === 'sleeve') {
      return {
        slotCols: profile.slotCols,
        poolCols: profile.maxPoolCols ?? profile.slotCols,
        lineClamp: profile.lineClamp,
        insigniaH: 0,
        insigniaW: 140,
        hintClamp: 6,
        hintSize: 12,
        gapPx: 9,
        labelSize: 15,
        cardPadY: 10,
        cardPadX: 12,
        slotMinH: 54,
      }
    }
    return {
      slotCols: profile.slotCols,
      poolCols: profile.maxPoolCols ?? profile.slotCols,
      lineClamp: profile.lineClamp,
      insigniaH: 80,
      insigniaW: 96,
      hintClamp: 4,
      hintSize: 11,
      gapPx: 10,
      labelSize: 15,
      cardPadY: 11,
      cardPadX: 13,
      slotMinH: 56,
    }
  })

  useLayoutEffect(() => {
    const board = boardRef.current
    if (!board) return

    const run = () => {
      const next = fitMatchBoard(board, slotCount, profile, category)
      setFit((prev) =>
        prev.slotCols === next.slotCols &&
        prev.poolCols === next.poolCols &&
        prev.lineClamp === next.lineClamp &&
        prev.insigniaH === next.insigniaH &&
        prev.labelSize === next.labelSize &&
        prev.gapPx === next.gapPx
          ? prev
          : next,
      )
    }

    run()
    const ro = new ResizeObserver(() => requestAnimationFrame(run))
    ro.observe(board)
    if (board.parentElement) ro.observe(board.parentElement)
    return () => ro.disconnect()
  }, [profile, slotCount, resetKey, category])

  return { boardRef, fit }
}