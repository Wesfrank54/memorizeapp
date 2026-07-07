import { useMemo } from 'react'
import { gradePassageChunk, livePassageMarks } from '../../core/passage.ts'

/**
 * Word-by-word green/red feedback while typing or after submit.
 * Reuses passage recall logic: live prefix match while editing, full positional
 * grade once checked.
 */
export function LiveTypingMarks({
  expected,
  given,
  graded = false,
  className = '',
}: {
  expected: string
  given: string
  /** After submit — show final per-word grade (expected words, green/red). */
  graded?: boolean
  className?: string
}) {
  const marks = useMemo(() => {
    if (!given.trim()) return []
    if (graded) return gradePassageChunk(expected, given).marks
    return livePassageMarks(expected, given)
  }, [expected, given, graded])

  if (marks.length === 0) return null

  return (
    <div className={`passage-diff passage-live-diff ${className}`.trim()} aria-live="polite">
      {marks.map((m, i) => (
        <span key={i} className={m.ok ? 'w-ok' : 'w-no'}>
          {m.text}{' '}
        </span>
      ))}
    </div>
  )
}