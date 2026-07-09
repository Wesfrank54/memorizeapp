import { useLayoutEffect, useRef, useState } from 'react'
import { fitOrderBoard, type OrderBoardFit, type OrderLayoutProfile } from '../../core/order-layout.ts'

export function useOrderBoardFit(profile: OrderLayoutProfile, slotCount: number, resetKey: string) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<OrderBoardFit>(() => ({
    slotCols: profile.slotCols,
    poolCols: profile.slotCols,
    lineClamp: profile.lineClamp,
  }))

  useLayoutEffect(() => {
    const board = boardRef.current
    if (!board) return

    const run = () => {
      const next = fitOrderBoard(board, slotCount, profile)
      setFit((prev) =>
        prev.slotCols === next.slotCols && prev.poolCols === next.poolCols && prev.lineClamp === next.lineClamp
          ? prev
          : next,
      )
    }

    run()
    const ro = new ResizeObserver(() => requestAnimationFrame(run))
    ro.observe(board)
    if (board.parentElement) ro.observe(board.parentElement)
    return () => ro.disconnect()
  }, [profile, slotCount, resetKey])

  return { boardRef, fit }
}