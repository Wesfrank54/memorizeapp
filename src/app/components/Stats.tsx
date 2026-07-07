import type { AppState } from '../../core/types.ts'
import { computeStats } from '../../core/stats.ts'
import { computeConcepts } from '../../core/concepts.ts'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function Stats({ state }: { state: AppState }) {
  const s = computeStats(state, new Date())
  const ret = s.trueRetention30d
  const concepts = computeConcepts(state, { minAttempts: 1 })

  return (
    <div className="panel">
      <div className="stat-grid">
        <Stat label="due today" value={s.dueToday} />
        <Stat label="new available" value={s.newCount} />
        <Stat label="reviews today" value={s.reviewsToday} />
        <Stat label="true retention · 30d" value={ret === null ? '—' : `${Math.round(ret * 100)}%`} />
      </div>

      <div className="substat-row">
        <span className="muted small">{s.totalCards} cards total</span>
        <span className="muted small">{s.learningCount} learning</span>
        <span className="muted small">{s.reviewCount} in review</span>
      </div>

      {s.perDeck.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Deck</th>
              <th>Cards</th>
              <th>Due</th>
              <th>New</th>
            </tr>
          </thead>
          <tbody>
            {s.perDeck.map((d) => (
              <tr key={d.deckId}>
                <td>{d.name}</td>
                <td>{d.total}</td>
                <td>{d.due}</td>
                <td>{d.new}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {ret === null && <p className="muted small">True retention appears once you have review history beyond first-time cards.</p>}

      <div className="concepts">
        <div className="stat-label">weak concepts</div>
        {concepts.length === 0 ? (
          <p className="muted small">
            Answer cards with a graded mode (Review → Type/Fill blank/Choices, or the Quiz tab) to surface the concepts
            you're weakest on.
          </p>
        ) : (
          concepts.slice(0, 8).map((c) => (
            <div key={c.key} className="concept-row">
              <div className="concept-head">
                <span>
                  {c.label} {c.kind === 'deck' && <span className="muted small">(deck)</span>}
                </span>
                <span className="muted small">
                  {Math.round(c.accuracy * 100)}% · {c.attempts} attempt{c.attempts === 1 ? '' : 's'}
                </span>
              </div>
              <div className="concept-bar">
                <div
                  className={`concept-fill ${c.accuracy < 0.6 ? 'low' : c.accuracy < 0.8 ? 'mid' : 'high'}`}
                  style={{ width: `${Math.round(c.accuracy * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
