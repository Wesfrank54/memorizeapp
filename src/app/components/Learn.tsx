import { useEffect, useMemo, useState } from 'react'
import { Rating } from 'ts-fsrs'
import type { AppState, Card, FamiliarityLevel, Note } from '../../core/types.ts'
import { renderContent } from '../../core/schedule.ts'
import { clearLearnResume, loadLearnResume, saveLearnResume } from '../../core/learn-persist.ts'
import {
  addLearnHighlight,
  graduateLearnMastery,
  review,
  recordLearnAttempt,
  updateSettings,
} from '../../core/store.ts'
import { computeConcepts } from '../../core/concepts.ts'
import { clozeFullText } from '../../core/cloze.ts'
import { PASSAGE_PASS_SCORE, passageWantsFullRecall } from '../../core/passage.ts'
import {
  answerLearn,
  answerUnitSynthesis,
  buildStudyNow,
  buildUnits,
  cardSeen,
  currentLearn,
  decayLearnSession,
  deferredLearnCount,
  FAMILIARITY_LABELS,
  FAMILIARITY_OPTIONS,
  isLearnResumable,
  LADDER_LABELS,
  learnBlankCoverage,
  phaseLabel,
  skipLearn,
  startLearnFromUnits,
  tickLearnQueue,
  waitingLearnCount,
  weakUnitCandidates,
  type LearnSession,
  type LearnTabMode,
  type PersistedLearn,
} from '../../core/learn.ts'
import { UnitSynthesis } from './UnitSynthesis.tsx'

const ADAPTIVE_BASE_COVERAGE = 0.55
import { GradedAnswer, type GradedMode } from './GradedAnswer.tsx'
import { PassageRecall } from './PassageRecall.tsx'
import { VerdictBanner } from './VerdictBanner.tsx'

interface ResumeSource {
  p: PersistedLearn
  key: LearnTabMode
}

/** First saved session (either former tab) that can actually be resumed. */
function firstResumableSaved(): ResumeSource | null {
  for (const key of ['adaptive', 'manual'] as const) {
    const p = loadLearnResume(key)
    if (p && isLearnResumable(p)) return { p, key }
  }
  return null
}

export function Learn({ state, onGoToReview }: { state: AppState; onGoToReview?: () => void }) {
  // The unified Learn tab IS the (formerly separate) adaptive experience: each
  // card starts from its own data, familiarity covers only unseen cards.
  const variant: LearnTabMode = 'adaptive'
  const [deckId, setDeckId] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [session, setSession] = useState<LearnSession | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [selfVerdict, setSelfVerdict] = useState<boolean | null>(null)
  // Adopt a saved session from either former tab (manual sessions finish under
  // their original semantics; new saves always land on the adaptive key). The
  // source key travels with the payload so only the save the user acted on is
  // ever cleared — a second save on the other key surfaces afterwards.
  const [savedResume, setSavedResume] = useState<ResumeSource | null>(firstResumableSaved)
  const [setupStep, setSetupStep] = useState<'units' | 'familiarity'>('units')
  const [familiarity, setFamiliarity] = useState<FamiliarityLevel>('some')

  const notesById = useMemo(() => new Map(state.notes.map((n) => [n.id, n])), [state.notes])
  const cardsById = useMemo(() => new Map(state.cards.map((c) => [c.id, c])), [state.cards])
  const deckCardIds = useMemo(
    () => state.cards.filter((c) => !deckId || c.deckId === deckId).map((c) => c.id),
    [state.cards, deckId],
  )
  const allUnits = useMemo(() => buildUnits(state, deckCardIds, { byConcept: true }), [state, deckCardIds])
  const chosenUnits = useMemo(
    () => allUnits.filter((u) => selectedKeys.has(u.key)),
    [allUnits, selectedKeys],
  )
  // Weak-area targeting (adaptive tab): concepts you keep missing, weakest first.
  const weakTargets = useMemo(() => weakUnitCandidates(state, deckCardIds), [state, deckCardIds])
  const studySize = state.settings.studyNowCards ?? 15
  // Only planned while idle on the start screen — the O(cards × events) scan
  // must not rerun on every answer during an active session.
  const studyPlan = useMemo(
    () => (session ? null : buildStudyNow(state, { maxCards: studySize })),
    [state, studySize, session],
  )

  useEffect(() => {
    setSelectedKeys(new Set())
  }, [deckId])

  const sessionTicked = useMemo(() => (session ? tickLearnQueue(session) : null), [session])
  const cur = sessionTicked ? currentLearn(sessionTicked) : null

  useEffect(() => {
    if (session && sessionTicked && sessionTicked !== session) {
      setSession(sessionTicked)
    }
  }, [session, sessionTicked])

  useEffect(() => {
    setRevealed(false)
    setSelfVerdict(null)
  }, [cur?.cardId, cur?.rung, cur?.pretest, session?.seen])

  useEffect(() => {
    if (selfVerdict === null || !cur?.cardId || !session) return
    const passed = selfVerdict
    const id = cur.cardId
    const t = window.setTimeout(() => {
      review(id, passed ? Rating.Good : Rating.Again)
      applyAnswer(passed)
      setSelfVerdict(null)
    }, 650)
    return () => window.clearTimeout(t)
  }, [selfVerdict, cur?.cardId, session])

  function toggleUnit(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Discard only the save the user acted on; if the other former tab still
  // holds a resumable session, surface it instead of silently deleting it.
  function dropOfferedResume() {
    if (savedResume) clearLearnResume(savedResume.key)
    setSavedResume(firstResumableSaved())
  }

  function persistIfActive(s: LearnSession) {
    if (s.done) return
    const payload: PersistedLearn = {
      session: s,
      savedAt: new Date().toISOString(),
      deckId,
      unitKeys: [...selectedKeys],
    }
    saveLearnResume(payload, variant)
    setSavedResume({ p: payload, key: variant })
  }

  function finishSession(s: LearnSession) {
    clearLearnResume(variant)
    setSavedResume(firstResumableSaved())
    if (s.graduatedCardIds.length > 0) addLearnHighlight(s.graduatedCardIds)
  }

  // Cards with no graded attempts or review events — the only ones the
  // familiarity self-report still describes (studied cards start from data).
  const unseenChosenCount = useMemo(
    () => chosenUnits.flatMap((u) => u.cardIds).filter((id) => !cardSeen(state, id)).length,
    [chosenUnits, state],
  )

  function beginFamiliarityStep() {
    if (chosenUnits.length === 0) return
    // Every chosen card has data → nothing for the familiarity answer to do.
    if (unseenChosenCount === 0) {
      start()
      return
    }
    setSetupStep('familiarity')
  }

  function start() {
    if (chosenUnits.length === 0) return
    dropOfferedResume()
    setSetupStep('units')
    setSession(
      startLearnFromUnits(state, chosenUnits, {
        tabMode: 'adaptive',
        familiarity,
      }),
    )
  }

  // One-click session across the whole collection: fading memories first, then
  // weak cards, then a few new ones. No deck/unit picking, no familiarity step
  // ('new' gives unseen cards the try-before-teach pretest; seen cards start
  // from their own data regardless).
  function startStudyNow() {
    if (!studyPlan || studyPlan.total === 0) return
    dropOfferedResume()
    setSetupStep('units')
    setSession(
      startLearnFromUnits(state, studyPlan.units, {
        tabMode: 'adaptive',
        familiarity: 'new',
        focus: 'study',
      }),
    )
  }

  // Drill weak areas: units from your weakest concepts, no familiarity step
  // (history drives the starting rungs), and mastery requires passing the top
  // rung twice — spaced apart — so the material is actually drilled in.
  function startWeakDrill() {
    if (weakTargets.length === 0) return
    dropOfferedResume()
    setSetupStep('units')
    setSession(
      startLearnFromUnits(state, weakTargets.map((t) => t.unit), {
        tabMode: 'adaptive',
        familiarity: 'some',
        adaptiveLadder: true,
        masteryStreak: 2,
        focus: 'weak',
      }),
    )
  }

  function resumeSaved() {
    if (!savedResume) return
    const { p, key } = savedResume
    // The session is live from here and persists under the adaptive key —
    // clear its source so a stale copy can't resurface later.
    clearLearnResume(key)
    setSavedResume(null)
    setDeckId(p.deckId)
    setSelectedKeys(new Set(p.unitKeys))
    if (p.session.familiarity) setFamiliarity(p.session.familiarity)
    setSession(decayLearnSession(p.session, p.savedAt))
  }

  function discardResume() {
    dropOfferedResume()
  }

  function saveAndExit() {
    if (!session || session.done) {
      setSession(null)
      return
    }
    persistIfActive(session)
    setSession(null)
  }

  // NOTE: these must NOT run store mutations inside a setSession updater —
  // React StrictMode double-invokes updaters in dev, which duplicated the
  // graduation ReviewEvent for every mastered card. Side effects run once
  // here in the handler; setSession receives a plain computed value.
  function applySynthesis(results: { cardId: string; passed: boolean }[]) {
    const s = sessionTicked ?? session
    if (!s) return
    const next = answerUnitSynthesis(state, s, results)
    if (next.done) finishSession(next)
    else persistIfActive(next)
    setSession(next)
  }

  function applyAnswer(passed: boolean) {
    const s = sessionTicked ?? session
    if (!s) return
    const { session: next, mastery } = answerLearn(state, s, passed)
    if (mastery && (mastery.phase === 'learn' || mastery.phase === 'catchup')) {
      graduateLearnMastery(mastery.cardId, mastery.mode, mastery.phase)
      // Collapsed passage twins: reconstructing the full text proves recall of
      // every sibling's blank, so they graduate together.
      for (const peer of mastery.peerCardIds ?? []) {
        graduateLearnMastery(peer, mastery.mode, mastery.phase)
      }
    }
    if (next.done) finishSession(next)
    else persistIfActive(next)
    setSession(next)
  }

  function skip() {
    const s = sessionTicked ?? session
    if (!s) return
    const next = skipLearn(state, s)
    persistIfActive(next)
    setSession(next)
  }

  useEffect(() => {
    if (!session || session.done) return
    persistIfActive(session)
  }, [session?.seen, session?.phaseIndex, session?.done])

  useEffect(() => {
    if (!session || !cur) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 's' && e.key !== 'S') return
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      e.preventDefault()
      skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, cur?.cardId])

  const s = sessionTicked ?? session

  // ---- adaptive: familiarity step ----
  if (!session && setupStep === 'familiarity') {
    const previewCards = chosenUnits.reduce((a, u) => a + u.cardIds.length, 0)
    return (
      <div className="panel form">
        <h2 className="opt-title">How familiar is this material?</h2>
        <p className="muted small">
          This applies to the <strong>{unseenChosenCount}</strong> card{unseenChosenCount === 1 ? '' : 's'} you
          haven&apos;t studied here yet — it sets where they start on the{' '}
          <strong>choices → fill-blank → type</strong> ladder. Cards you&apos;ve already answered start from their own
          track record and memory state.
        </p>
        <p className="muted small">
          {chosenUnits.length} units · {previewCards} cards · {unseenChosenCount} brand new
        </p>
        <div className="familiarity-picker">
          {FAMILIARITY_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={`familiarity-chip${familiarity === opt.id ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name="familiarity"
                checked={familiarity === opt.id}
                onChange={() => setFamiliarity(opt.id)}
              />
              <span className="familiarity-label">{opt.label}</span>
              <span className="muted small">{opt.hint}</span>
            </label>
          ))}
        </div>
        <div className="row gap learn-actions">
          <button type="button" className="link" onClick={() => setSetupStep('units')}>
            Back
          </button>
          <button className="primary" onClick={start}>
            Start learning
          </button>
        </div>
      </div>
    )
  }

  // ---- start screen ----
  if (!session) {
    const previewCards = chosenUnits.reduce((a, u) => a + u.cardIds.length, 0)
    return (
      <div className="panel form">
        <h2 className="opt-title">Learn</h2>
        <p className="muted small">
          Each card starts at a difficulty set by your own track record — recent answers and memory state.
          Brand-new cards use a one-time familiarity answer, and blank coverage adapts as you perform. Mastery
          graduates cards into your FSRS schedule.
        </p>
        {studyPlan ? (
          <div className="panel inset study-now">
            <div className="row spread">
              <div className="stat-label">Study now</div>
              <select
                value={studySize}
                onChange={(e) => updateSettings({ studyNowCards: Number(e.target.value) })}
                aria-label="session size"
              >
                <option value={8}>Short · 8 cards</option>
                <option value={15}>Standard · 15 cards</option>
                <option value={25}>Long · 25 cards</option>
              </select>
            </div>
            <p className="muted small">
              {studyPlan.total > 0
                ? <>One click, whole collection: <strong>{studyPlan.due}</strong> to refresh · <strong>{studyPlan.weak}</strong> weak · <strong>{studyPlan.fresh}</strong> new</>
                : 'All caught up — nothing fading, no weak spots, no new cards waiting.'}
            </p>
            <button type="button" className="primary" disabled={studyPlan.total === 0} onClick={startStudyNow}>
              Study now{studyPlan.total > 0 ? ` · ${studyPlan.total} cards` : ''}
            </button>
          </div>
        ) : null}
        {(
          <div className="panel inset weak-targets">
            <div className="row spread">
              <div className="stat-label">Weak areas</div>
              <span className="muted small">from your graded answers</span>
            </div>
            {weakTargets.length > 0 ? (
              <>
                {weakTargets.map((t) => (
                  <div key={t.stat.key} className="concept-row">
                    <span>
                      {t.stat.label}{' '}
                      <span className="muted small">
                        · {t.unit.cardIds.length} card{t.unit.cardIds.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="muted small">
                      {Math.round(t.stat.accuracy * 100)}% correct · {t.stat.attempts} answers
                    </span>
                  </div>
                ))}
                <button type="button" className="primary weak-drill-btn" onClick={startWeakDrill}>
                  Drill weak areas
                </button>
                <p className="muted small">
                  Cards from weak topics are <strong>shuffled together</strong> — each must pass its hardest mode{' '}
                  <strong>twice in a row</strong> to master.
                </p>
              </>
            ) : (
              <p className="muted small">
                Nothing weak detected yet — graded answers in Review, Quiz, and Learn feed this. Keep studying and
                weak concepts will surface here automatically.
              </p>
            )}
          </div>
        )}
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
          <div className="row spread">
            <label>Concept units</label>
            <span className="muted small">
              {chosenUnits.length} of {allUnits.length} selected · {previewCards} cards
            </span>
          </div>
          {allUnits.length > 0 ? (
            <>
              <div className="unit-picker-actions">
                <button type="button" className="link" onClick={() => setSelectedKeys(new Set(allUnits.map((u) => u.key)))}>
                  select all
                </button>
                <button type="button" className="link" onClick={() => setSelectedKeys(new Set())}>
                  clear
                </button>
              </div>
              <div className="unit-picker">
                {allUnits.map((u) => (
                  <label key={u.key} className={`unit-chip selectable${selectedKeys.has(u.key) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={selectedKeys.has(u.key)} onChange={() => toggleUnit(u.key)} />
                    <span>
                      {u.label} <span className="muted">({u.cardIds.length})</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small">No cards in this deck.</p>
          )}
        </div>
        <div className="panel inset learn-adaptive-note">
          <div className="stat-label">Auto-adjusted during session</div>
          <p className="muted small">
            Starting ladder rung from each card&apos;s track record · blank coverage ramps up when you answer well and
            eases off when you miss · difficulty increases as you master cards
          </p>
        </div>
        <details className="learn-customize">
          <summary className="muted small">Customize</summary>
          <div className="field">
            <label>
              Blank coverage (base){' '}
              <span className="muted small">
                {Math.round((state.settings.blankCoverage ?? ADAPTIVE_BASE_COVERAGE) * 100)}%
              </span>
            </label>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={Math.round((state.settings.blankCoverage ?? ADAPTIVE_BASE_COVERAGE) * 100)}
              onChange={(e) => updateSettings({ blankCoverage: Number(e.target.value) / 100 })}
            />
            <div className="muted small">
              starting point for fill-in-the-blank / recite density — still ramps with rung and performance
            </div>
          </div>
          <div className="field learn-toggles">
            <label className="unit-chip selectable">
              <input
                type="checkbox"
                checked={state.settings.learnUnitSynthesis !== false}
                onChange={(e) => updateSettings({ learnUnitSynthesis: e.target.checked })}
              />
              <span>Full topic review after each multi-card unit</span>
            </label>
          </div>
        </details>
        {savedResume ? (
          <div className="learn-resume panel inset">
            <div className="row spread">
              <div className="stat-label">Resume saved session</div>
              <button type="button" className="link" onClick={discardResume}>
                Discard
              </button>
            </div>
            <p className="muted small">
              {savedResume.p.session.units.length} units · {savedResume.p.session.masteredCount}/
              {savedResume.p.session.totalToMaster} mastered · saved{' '}
              {new Date(savedResume.p.savedAt).toLocaleString()}
            </p>
            <button type="button" className="primary" onClick={resumeSaved}>
              Resume
            </button>
          </div>
        ) : null}
        <button className="primary" onClick={beginFamiliarityStep} disabled={chosenUnits.length === 0}>
          {unseenChosenCount > 0 ? 'Continue' : 'Start learning'}
        </button>
      </div>
    )
  }

  // ---- summary ----
  if (!cur || !s) {
    const acc = session.attempts ? Math.round((session.correct / session.attempts) * 100) : 0
    const weak = computeConcepts(state, { minAttempts: 1 }).slice(0, 5)
    const graduated = session.graduatedCardIds.length
    return (
      <div className="panel center">
        <div className="done-mark">✓</div>
        <h2>{session.focus === 'weak' ? 'Weak areas drilled in' : `Mastered ${session.totalToMaster} cards`}</h2>
        <p className="muted">
          {session.focus === 'weak'
            ? `${session.totalToMaster} weak cards mastered ×2 · ${session.attempts} graded answers · ${acc}% correct`
            : `${session.units.length} units · ${session.attempts} graded answers · ${acc}% correct`}
        </p>
        {graduated > 0 && (
          <p className="muted small">
            {graduated} card{graduated === 1 ? '' : 's'} graduated into your FSRS schedule
            {state.settings.learnGraduateFsrs !== false ? ' and queued at the front of Review' : ''}.
          </p>
        )}
        {weak.length > 0 && (
          <div className="quiz-weak">
            <div className="stat-label">weakest concepts</div>
            {weak.map((c) => (
              <div key={c.key} className="concept-row">
                <span>{c.label}</span>
                <span className="muted small">
                  {Math.round(c.accuracy * 100)}% · {c.attempts}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="row gap">
          {graduated > 0 && onGoToReview ? (
            <button className="primary" onClick={onGoToReview}>
              Review graduated cards
            </button>
          ) : null}
          <button className={graduated > 0 && onGoToReview ? 'link' : 'primary'} onClick={() => setSession(null)}>
            done
          </button>
        </div>
      </div>
    )
  }

  // ---- running ----
  const baseCoverage = state.settings.blankCoverage ?? ADAPTIVE_BASE_COVERAGE

  if (cur.unitSynthesis) {
    const unit = s.units[cur.unitSynthesis.unitIndex]
    const synthCoverage = learnBlankCoverage(s, 0, ['blank'], baseCoverage)
    return (
      <div>
        <div className="learn-head">
          <span className="muted small">{phaseLabel(s)}</span>
        </div>
        <div className="panel review">
          <div className="review-meta">
            <span className="chip">Full unit review</span>
            <span className="chip chip-due">{unit.label}</span>
          </div>
          <UnitSynthesis state={state} unit={unit} coverage={synthCoverage} onSubmit={applySynthesis} />
          <div className="skip-row">
            <button type="button" className="link skip-link" onClick={saveAndExit}>
              Save &amp; exit
            </button>
          </div>
        </div>
      </div>
    )
  }

  const card = cardsById.get(cur.cardId) as Card | undefined
  const note = card ? (notesById.get(card.noteId) as Note | undefined) : undefined
  if (!card || !note) {
    return (
      <div className="panel center">
        <button className="link" onClick={() => applyAnswer(true)}>
          skip missing card
        </button>
      </div>
    )
  }

  const { question, answer: answerText } = renderContent(note, card)
  const isReview = s.phases[s.phaseIndex]?.kind === 'review'
  const coverage =
    cur.mode === 'passage' || cur.mode === 'blank'
      ? learnBlankCoverage(s, cur.rung, cur.ladder, baseCoverage)
      : baseCoverage
  const passageVariant = state.attempts.filter((a) => a.cardId === cur.cardId).length
  const passageText = note.type === 'cloze' ? clozeFullText(note.fields.text ?? '') : answerText
  const promptText =
    cur.pretest ? `${question} — try from memory first` : cur.mode === 'passage' && note.type === 'cloze' ? 'Fill in the blanks' : question

  const deferred = deferredLearnCount(s)
  const waiting = waitingLearnCount(s)

  return (
    <div>
      <div className="learn-head">
        <span className="muted small">
          {phaseLabel(s)} · learned {s.masteredCount}/{s.totalToMaster}
          {s.focus !== 'study' ? (
            <span className="deferred-badge"> · {FAMILIARITY_LABELS[s.familiarity]}</span>
          ) : null}
          {s.difficultyBias > 0 ? (
            <span className="deferred-badge"> · difficulty +{Math.round(s.difficultyBias * 100)}%</span>
          ) : null}
          {Math.abs((s.coverageBias ?? 0.5) - 0.5) > 0.02 ? (
            <span className="deferred-badge">
              {' '}
              · coverage {s.coverageBias! > 0.5 ? '+' : ''}
              {Math.round((s.coverageBias! - 0.5) * 100)}%
            </span>
          ) : null}
          {deferred > 0 && !s.catchUp ? <span className="deferred-badge"> · {deferred} deferred</span> : null}
          {waiting > 0 ? <span className="deferred-badge"> · {waiting} spaced</span> : null}
        </span>
        <div className="ladder">
          {cur.pretest ? (
            <span className="rung active">Pre-test</span>
          ) : (
            cur.ladder.map((m, i) => (
              <span key={`${m}-${i}`} className={`rung ${i === cur.rung ? 'active' : i < cur.rung ? 'done' : ''}`}>
                {LADDER_LABELS[m]}
              </span>
            ))
          )}
          {!cur.pretest && cur.masteryStreak > 1 ? (
            <span className="rung streak" title="Drill-in: pass the hardest mode twice in a row to master">
              ×{cur.masteryStreak}
              {cur.rung === cur.ladder.length - 1 ? ` · ${cur.topPasses + 1}/${cur.masteryStreak}` : ''}
            </span>
          ) : null}
        </div>
      </div>
      <div className="panel review">
        <div className="review-meta">
          <span className="chip">{state.decks.find((d) => d.id === card.deckId)?.name ?? '—'}</span>
          {isReview && <span className="chip chip-due">review</span>}
          {cur.pretest && <span className="chip">pre-test</span>}
        </div>
        <div className="card-face question">{promptText}</div>

        {cur.mode === 'passage' ? (
          <PassageRecall
            key={`${cur.cardId}-${s.seen}`}
            text={passageText}
            coverage={coverage}
            variant={passageVariant}
            fullRecall={passageWantsFullRecall(passageText)}
            onDone={(score) => {
              recordLearnAttempt(card.id, 'passage', score >= PASSAGE_PASS_SCORE)
              applyAnswer(score >= PASSAGE_PASS_SCORE)
            }}
          />
        ) : cur.mode === 'self' ? (
          revealed ? (
            <>
              <hr className="divider" />
              <div className="card-face answer">{answerText}</div>
              {selfVerdict !== null ? (
                <VerdictBanner correct={selfVerdict} expected={!selfVerdict ? answerText : undefined} />
              ) : (
                <>
                  <p className="muted small self-check-prompt">Were you right?</p>
                  <div className="self-check-row">
                    <button
                      type="button"
                      className="rate good self-check-btn"
                      onClick={() => setSelfVerdict(true)}
                    >
                      <span className="rate-label">Correct ✓</span>
                    </button>
                    <button
                      type="button"
                      className="rate again self-check-btn"
                      onClick={() => setSelfVerdict(false)}
                    >
                      <span className="rate-label">Incorrect ✗</span>
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <button className="primary reveal" onClick={() => setRevealed(true)}>
              Show answer
            </button>
          )
        ) : (
          <GradedAnswer
            key={`${cur.cardId}-${s.seen}`}
            state={state}
            card={card}
            note={note}
            mode={cur.mode as GradedMode}
            blankCoverage={cur.mode === 'blank' ? coverage : undefined}
            onGraded={(r, ctx) => {
              recordLearnAttempt(card.id, ctx.mode, r.correct)
              applyAnswer(r.correct)
            }}
          />
        )}
        <div className="skip-row">
          <button type="button" className="link skip-link" onClick={skip} title="Keyboard: S">
            Skip · come back later
          </button>
          <button type="button" className="link skip-link" onClick={saveAndExit}>
            Save &amp; exit
          </button>
        </div>
      </div>
    </div>
  )
}