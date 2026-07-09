import { useLayoutEffect, useRef, useState } from 'react'
import {
  fitMatchBoard,
  type MatchBoardFit,
} from '../../core/match-layout.ts'
import type { OrderLayoutProfile } from '../../core/order-layout.ts'

export function useMatchBoardFit(
  profile: OrderLayoutProfile,
  slotCount: number,
  resetKey: string,
  category: 'collar' | 'shoulder',
) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<MatchBoardFit>(() =>
    category === 'shoulder'
      ? {
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
      : {
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
        },
  )

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