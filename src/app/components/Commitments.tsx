import { useEffect, useState } from 'react'
import type { AppState, Commitment, CommitmentKind, Recipient } from '../../core/types.ts'
import {
  computeLedger,
  computeStreak,
  evaluateCommitment,
  STAKE_CAP_CENTS,
} from '../../core/accountability.ts'
import { addCommitment, cancelCommitment, tickCommitments } from '../../core/store.ts'
import { CheckpointSession } from './CheckpointSession.tsx'

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function Commitments({ state }: { state: AppState }) {
  const [checkpoint, setCheckpoint] = useState<{ deckId: string | null; label: string } | null>(null)

  useEffect(() => {
    tickCommitments()
  }, [])

  if (checkpoint) {
    return (
      <CheckpointSession
        state={state}
        deckId={checkpoint.deckId}
        deckLabel={checkpoint.label}
        onDone={() => setCheckpoint(null)}
      />
    )
  }

  const now = new Date()
  const streak = computeStreak(state.events, now)
  const ledger = computeLedger(state.commitments)
  const active = state.commitments.filter((c) => c.status === 'active')
  const resolved = state.commitments.filter((c) => c.status !== 'active')
  const deckName = (id: string | null | undefined) => (id ? state.decks.find((d) => d.id === id)?.name ?? '—' : 'All decks')

  return (
    <div className="commit">
      <div className="streak-row">
        <div className="streak">
          <span className="streak-fire">🔥</span>
          <span className="streak-num">{streak.current}</span>
          <span className="muted small">day streak{streak.reviewedToday ? '' : ' · review today to keep it'}</span>
        </div>
        <span className="muted small">{streak.freezesAvailable} freeze{streak.freezesAvailable === 1 ? '' : 's'}</span>
      </div>

      <div className="ledger panel">
        <div className="ledger-item">
          <div className="ledger-val">{money(ledger.atRiskCents)}</div>
          <div className="stat-label">at risk</div>
        </div>
        <div className="ledger-item">
          <div className="ledger-val danger">{money(ledger.forfeitedCents)}</div>
          <div className="stat-label">to charity</div>
        </div>
        <div className="ledger-item">
          <div className="ledger-val good">{money(ledger.honoredCents)}</div>
          <div className="stat-label">honored</div>
        </div>
      </div>
      <p className="muted small demo-note">
        Demo ledger — no real money moves. Stakes are tied to <strong>verified recall</strong>, not time in the app, and
        real forfeits would go to charity.
      </p>

      {active.map((c) => {
        const ev = evaluateCommitment(state, c, now)
        return (
          <div key={c.id} className="panel commitment">
            <div className="row between">
              <strong>{c.title}</strong>
              <span className={`chip ${ev.status === 'failed' ? 'chip-fail' : ev.todayRemaining === 0 || ev.status === 'met' ? 'chip-due' : 'chip-new'}`}>
                {ev.headline}
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(ev.progressPct * 100)}%` }} />
            </div>
            <div className="muted small">{ev.detail}</div>
            <div className="row between commit-foot">
              <span className="muted small">
                {money(c.stakeCents)} → {c.recipient === 'charity' ? 'charity' : 'anti-charity'} · due{' '}
                {new Date(c.deadline).toLocaleDateString()}
              </span>
              <span className="row">
                {c.kind === 'retention-goal' && (
                  <button
                    className="link"
                    onClick={() => setCheckpoint({ deckId: c.deckId ?? null, label: deckName(c.deckId) })}
                  >
                    take checkpoint
                  </button>
                )}
                <button className="link danger" onClick={() => cancelCommitment(c.id)}>
                  cancel
                </button>
              </span>
            </div>
          </div>
        )
      })}

      {resolved.length > 0 && (
        <div className="panel">
          <div className="stat-label">resolved</div>
          {resolved.map((c) => (
            <div key={c.id} className="row between resolved-row">
              <span>{c.title}</span>
              <span className={`chip ${c.status === 'met' ? 'chip-due' : c.status === 'failed' ? 'chip-fail' : ''}`}>
                {c.status === 'met' ? 'met' : c.status === 'failed' ? `forfeited ${money(c.stakeCents)}` : 'cancelled'}
              </span>
            </div>
          ))}
        </div>
      )}

      <NewCommitment state={state} />
    </div>
  )
}

function NewCommitment({ state }: { state: AppState }) {
  const [kind, setKind] = useState<CommitmentKind>('daily-reviews')
  const [dailyTarget, setDailyTarget] = useState(20)
  const [targetRetention, setTargetRetention] = useState(85)
  const [deckId, setDeckId] = useState<string>('')
  const [days, setDays] = useState(7)
  const [stake, setStake] = useState(5)
  const [recipient, setRecipient] = useState<Recipient>('charity')
  const [confirmed, setConfirmed] = useState(false)

  const maxStake = STAKE_CAP_CENTS / 100

  function create() {
    const deadline = new Date(Date.now() + days * 86_400_000).toISOString()
    const base = {
      title:
        kind === 'daily-reviews'
          ? `Review ${dailyTarget}/day for ${days} days`
          : `Hit ${targetRetention}% verified on ${deckId ? state.decks.find((d) => d.id === deckId)?.name : 'all decks'}`,
      createdAt: '',
      startDate: new Date().toISOString(),
      deadline,
      stakeCents: Math.round(stake * 100),
      recipient,
    }
    const input: Omit<Commitment, 'id' | 'createdAt' | 'status'> =
      kind === 'daily-reviews'
        ? { ...base, kind, dailyTarget, graceDays: 1 }
        : { ...base, kind, deckId: deckId || null, targetRetention: targetRetention / 100, minCards: 10 }
    addCommitment(input)
    setConfirmed(false)
  }

  return (
    <div className="panel form">
      <h2 className="opt-title">New commitment</h2>
      <div className="field">
        <div className="row toggle">
          <button className={kind === 'daily-reviews' ? 'active' : ''} onClick={() => setKind('daily-reviews')}>
            Daily reviews
          </button>
          <button className={kind === 'retention-goal' ? 'active' : ''} onClick={() => setKind('retention-goal')}>
            Verified retention
          </button>
        </div>
      </div>

      {kind === 'daily-reviews' ? (
        <div className="field">
          <label>Review at least</label>
          <div className="row">
            <input type="number" min={1} value={dailyTarget} onChange={(e) => setDailyTarget(Number(e.target.value))} />
            <span className="muted small">cards/day</span>
          </div>
        </div>
      ) : (
        <>
          <div className="field">
            <label>Deck</label>
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              <option value="">All decks</option>
              {state.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Verified recall target</label>
            <div className="row">
              <input type="number" min={50} max={100} value={targetRetention} onChange={(e) => setTargetRetention(Number(e.target.value))} />
              <span className="muted small">% on a proctored checkpoint (≥10 cards)</span>
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label>Deadline</label>
        <div className="row">
          <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          <span className="muted small">days from now</span>
        </div>
      </div>

      <div className="field">
        <label>Stake <span className="muted">— demo, capped at ${maxStake}</span></label>
        <div className="row">
          <span className="muted">$</span>
          <input type="number" min={0} max={maxStake} value={stake} onChange={(e) => setStake(Number(e.target.value))} />
          <div className="row toggle">
            <button className={recipient === 'charity' ? 'active' : ''} onClick={() => setRecipient('charity')}>
              charity
            </button>
            <button className={recipient === 'anti-charity' ? 'active' : ''} onClick={() => setRecipient('anti-charity')}>
              anti-charity
            </button>
          </div>
        </div>
      </div>

      <label className="row consent">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span className="muted small">
          I understand this is a demo — no real money moves, and real forfeits would go to charity.
        </span>
      </label>

      <button className="primary" onClick={create} disabled={!confirmed}>
        Commit
      </button>
    </div>
  )
}
