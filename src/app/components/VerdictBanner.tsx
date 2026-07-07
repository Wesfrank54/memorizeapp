/** Immediate correct/incorrect feedback shown as soon as an answer is graded. */
export function VerdictBanner({
  correct,
  near,
  expected,
  detail,
}: {
  correct: boolean
  near?: boolean
  expected?: string
  detail?: string
}) {
  return (
    <div className={`cp-verdict instant-verdict ${correct ? 'ok' : 'no'}`} role="status" aria-live="polite">
      {correct ? (near ? 'Close enough ✓' : 'Correct ✓') : 'Incorrect ✗'}
      {!correct && expected ? <span className="muted"> — answer: {expected}</span> : null}
      {detail ? <span className="muted"> — {detail}</span> : null}
    </div>
  )
}