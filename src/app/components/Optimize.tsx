import { useMemo, useState } from 'react'
import type { AppState } from '../../core/types.ts'
import { buildSequences, MIN_PREDICTIONS, optimizeWeights } from '../../core/optimizer.ts'
import type { OptimizeResult } from '../../core/optimizer.ts'
import { resetWeights, setOptimizedWeights } from '../../core/store.ts'

export function Optimize({ state }: { state: AppState }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<OptimizeResult | null>(null)

  const predictions = useMemo(
    () => buildSequences(state.events).reduce((acc, s) => acc + (s.grades.length - 1), 0),
    [state.events],
  )
  const personalized = (state.settings.fsrsWeights?.length ?? 0) > 0
  const enough = predictions >= MIN_PREDICTIONS

  function run() {
    setBusy(true)
    // Defer so the "optimizing…" state paints before the (synchronous) fit runs.
    window.setTimeout(() => {
      const res = optimizeWeights(state.events)
      // Only adopt weights that actually generalize better than the defaults.
      if (res && res.testLossOptimized < res.testLossDefault) setOptimizedWeights(res.weights, res.predictions)
      setResult(res)
      setBusy(false)
    }, 30)
  }

  const improved = !!result && result.testLossOptimized < result.testLossDefault
  const pct = result ? Math.round(((result.testLossDefault - result.testLossOptimized) / result.testLossDefault) * 100) : 0

  return (
    <div className="panel form">
      <h2 className="opt-title">Personalize scheduling</h2>
      <p className="muted small">
        Fits FSRS weights to your own review history so intervals match how <em>you</em> actually forget. Lower
        log-loss = better-calibrated predictions. FSRS recommends 1,000+ reviews for stable weights; this works with
        fewer, but treat small-sample results as provisional.
      </p>

      <div className="stat-grid opt-grid">
        <div className="stat">
          <div className="stat-value">{predictions}</div>
          <div className="stat-label">reviews available</div>
        </div>
        <div className="stat">
          <div className="stat-value">{personalized ? 'personalized' : 'default'}</div>
          <div className="stat-label">current weights</div>
        </div>
      </div>

      {personalized && (
        <p className="muted small">
          Last optimized {state.settings.lastOptimized ? new Date(state.settings.lastOptimized).toLocaleString() : '—'} from{' '}
          {state.settings.optimizedReviewCount ?? 0} reviews.
        </p>
      )}

      {!enough && (
        <p className="muted small">
          Need at least {MIN_PREDICTIONS} reviews (2nd+ review of a card) to optimize. Keep reviewing — you have{' '}
          {predictions}.
        </p>
      )}

      <div className="row between">
        <button className="primary" onClick={run} disabled={!enough || busy}>
          {busy ? 'optimizing…' : personalized ? 're-optimize' : 'optimize from my reviews'}
        </button>
        {personalized && (
          <button className="link" onClick={() => { resetWeights(); setResult(null) }}>
            reset to default weights
          </button>
        )}
      </div>

      {result && (
        <div className="opt-result">
          <div className="opt-metric">
            <span>held-out log-loss</span>
            <span>
              {result.testLossDefault.toFixed(3)} → <strong>{result.testLossOptimized.toFixed(3)}</strong>{' '}
              <span className={improved ? 'flash' : 'muted'}>{improved ? `−${pct}%` : 'no gain'}</span>
            </span>
          </div>
          <p className="muted small">
            {improved
              ? `Personalized weights applied — your due dates are recomputed from the same review log. Trained on ${result.predictions} reviews over ${result.iterations} steps.`
              : `No generalizing improvement found on ${result.predictions} reviews — keeping the default weights. This is expected with little history; revisit after more reviews.`}
          </p>
        </div>
      )}
    </div>
  )
}
