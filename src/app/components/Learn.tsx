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
import { PASSAGE_PASS_SCORE } from '../../core/passage.ts'
import {
  answerLearn,
  answerUnitSynthesis,
  buildUnits,
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

export function Learn({
  state,
  variant,
  onGoToReview,
}: {
  state: AppState
  variant: LearnTabMode
  onGoToReview?: () => void
}) {
  const isAdaptive = variant === 'adaptive'
  const [deckId, setDeckId] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [session, setSession] = useState<LearnSession | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [selfVerdict, setSelfVerdict] = useState<boolean | null>(null)
  const [savedResume, setSavedResume] = useState<PersistedLearn | null>(() => loadLearnResume(variant))
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
  const weakTargets = useMemo(
    () => (isAdaptive ? weakUnitCandidates(state, deckCardIds) : []),
    [state, deckCardIds, isAdaptive],
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

  function persistIfActive(s: LearnSession) {
    if (s.done) return
    const payload: PersistedLearn = {
      session: s,
      savedAt: new Date().toISOString(),
      deckId,
      unitKeys: [...selectedKeys],
    }
    saveLearnResume(payload, variant)
    setSavedResume(payload)
  }

  function finishSession(s: LearnSession) {
    clearLearnResume(variant)
    setSavedResume(null)
    if (s.graduatedCardIds.length > 0) addLearnHighlight(s.graduatedCardIds)
  }

  function beginFamiliarityStep() {
    if (chosenUnits.length === 0) return
    setSetupStep('familiarity')
  }

  function start() {
    if (chosenUnits.length === 0) return
    clearLearnResume(variant)
    setSavedResume(null)
    setSetupStep('units')
    setSession(
      startLearnFromUnits(state, chosenUnits, {
        tabMode: variant,
        familiarity: isAdaptive ? familiarity : undefined,
      }),
    )
  }

  // Drill weak areas: units from your weakest concepts, no familiarity step
  // (history drives the starting rungs), and mastery requires passing the top
  // rung twice — spaced apart — so the material is actually drilled in.
  function startWeakDrill() {
    if (weakTargets.length === 0) return
    clearLearnResume(variant)
    setSavedResume(null)
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
    const p = loadLearnResume(variant)
    if (!p || !isLearnResumable(p)) return
    setDeckId(p.deckId)
    setSelectedKeys(new Set(p.unitKeys))
    if (p.session.familiarity) setFamiliarity(p.session.familiarity)
    setSession(decayLearnSession(p.session, p.savedAt))
  }

  function discardResume() {
    clearLearnResume(variant)
    setSavedResume(null)
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
  if (!session && isAdaptive && setupStep === 'familiarity') {
    const previewCards = chosenUnits.reduce((a, u) => a + u.cardIds.length, 0)
    return (
      <div className="panel form">
        <h2 className="opt-title">How familiar is this material?</h2>
        <p className="muted small">
          We&apos;ll tailor where each card starts on the <strong>choices → fill-blank → type</strong> ladder. As you
          master cards, new ones get harder automatically.
        </p>
        <p className="muted small">
          {chosenUnits.length} units · {previewCards} cards
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
    const gap = state.settings.learnSpacingGap ?? 2
    return (
      <div className="panel form">
        <h2 className="opt-title">{isAdaptive ? 'Adaptive learn' : 'Learn'}</h2>
        <p className="muted small">
          {isAdaptive
            ? 'Tell us how familiar you are, then we tailor starting difficulty and adjust blank coverage as you perform. Mastery graduates cards into FSRS.'
            : 'Master one concept unit at a time, then cumulative review. You control spacing, coverage, and ladder options. Mastery graduates cards into your FSRS schedule.'}
        </p>
        {isAdaptive ? (
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
        ) : null}
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
        {isAdaptive ? (
          <div className="panel inset learn-adaptive-note">
            <div className="stat-label">Auto-adjusted during session</div>
            <p className="muted small">
              Starting ladder rung from your familiarity · blank coverage ramps up when you answer well and eases off
              when you miss · difficulty increases as you master cards
            </p>
          </div>
        ) : (
          <>
            <div className="field">
              <label>
                Spacing gap <span className="muted small">{gap} cards</span>
              </label>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={gap}
                onChange={(e) => updateSettings({ learnSpacingGap: Number(e.target.value) })}
              />
              <div className="muted small">other cards shown before a missed card returns</div>
            </div>
            <div className="field">
              <label>
                Blank coverage{' '}
                <span className="muted small">{Math.round((state.settings.blankCoverage ?? 0.6) * 100)}%</span>
              </label>
              <input
                type="range"
                min={30}
                max={100}
                step={10}
                value={Math.round((state.settings.blankCoverage ?? 0.6) * 100)}
                onChange={(e) => updateSettings({ blankCoverage: Number(e.target.value) / 100 })}
              />
              <div className="muted small">how much of each fill-in-the-blank / recite prompt is blanked</div>
            </div>
            <div className="field learn-toggles">
              <label className="unit-chip selectable">
                <input
                  type="checkbox"
                  checked={state.settings.learnInterleave !== false}
                  onChange={(e) => updateSettings({ learnInterleave: e.target.checked })}
                />
                <span>Interleave cumulative review</span>
              </label>
              <label className="unit-chip selectable">
                <input
                  type="checkbox"
                  checked={state.settings.learnAdaptiveLadder !== false}
                  onChange={(e) => updateSettings({ learnAdaptiveLadder: e.target.checked })}
                />
                <span>Skip easy rungs from history</span>
              </label>
              <label className="unit-chip selectable">
                <input
                  type="checkbox"
                  checked={state.settings.learnFsrsReviewRungs !== false}
                  onChange={(e) => updateSettings({ learnFsrsReviewRungs: e.target.checked })}
                />
                <span>FSRS-informed review difficulty</span>
              </label>
              <label className="unit-chip selectable">
                <input
                  type="checkbox"
                  checked={state.settings.learnGraduateFsrs !== false}
                  onChange={(e) => updateSettings({ learnGraduateFsrs: e.target.checked })}
                />
                <span>Graduate mastered cards into FSRS</span>
              </label>
              <label className="unit-chip selectable">
                <input
                  type="checkbox"
                  checked={!!state.settings.learnPretest}
                  onChange={(e) => updateSettings({ learnPretest: e.target.checked })}
                />
                <span>Pre-test new cards (try before teach)</span>
              </label>
              <label className="unit-chip selectable">
                <input
                  type="checkbox"
                  checked={state.settings.learnUnitSynthesis !== false}
                  onChange={(e) => updateSettings({ learnUnitSynthesis: e.target.checked })}
                />
                <span>Full topic review after each multi-card unit</span>
              </label>
            </div>
          </>
        )}
        {isLearnResumable(savedResume) ? (
          <div className="learn-resume panel inset">
            <div className="row spread">
              <div className="stat-label">Resume saved session</div>
              <button type="button" className="link" onClick={discardResume}>
                Discard
              </button>
            </div>
            <p className="muted small">
              {savedResume!.session.units.length} units · {savedResume!.session.masteredCount}/
              {savedResume!.session.totalToMaster} mastered · saved{' '}
              {new Date(savedResume!.savedAt).toLocaleString()}
            </p>
            <button type="button" className="primary" onClick={resumeSaved}>
              Resume
            </button>
          </div>
        ) : null}
        <button
          className="primary"
          onClick={isAdaptive ? beginFamiliarityStep : start}
          disabled={chosenUnits.length === 0}
        >
          {isAdaptive ? 'Continue' : 'Start learning'}
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
  const baseCoverage = isAdaptive ? ADAPTIVE_BASE_COVERAGE : (state.settings.blankCoverage ?? 0.6)

  if (cur.unitSynthesis) {
    const unit = s.units[cur.unitSynthesis.unitIndex]
    const synthCoverage = isAdaptive ? learnBlankCoverage(s, 0, ['blank'], baseCoverage) : baseCoverage
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
          {isAdaptive ? (
            <span className="deferred-badge"> · {FAMILIARITY_LABELS[s.familiarity]}</span>
          ) : null}
          {isAdaptive && s.difficultyBias > 0 ? (
            <span className="deferred-badge"> · difficulty +{Math.round(s.difficultyBias * 100)}%</span>
          ) : null}
          {isAdaptive && Math.abs((s.coverageBias ?? 0.5) - 0.5) > 0.02 ? (
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