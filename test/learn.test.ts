import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adaptiveStartRung,
  answerLearn,
  answerUnitSynthesis,
  blankCoverageForRung,
  buildPhases,
  buildUnits,
  cardLadder,
  currentLearn,
  familiarityBaseBias,
  familiarityStartRung,
  learnBlankCoverage,
  reviewRungFromFsrs,
  skipLearn,
  startLearn,
  startLearnFromUnits,
  startRungFromHistory,
  tickLearnQueue,
} from '../src/core/learn.ts'
import type { AppState } from '../src/core/types.ts'

let k = 0
function emptyState(): AppState {
  return { decks: [], notes: [], cards: [], events: [], tombstones: [], commitments: [], checkpoints: [], attempts: [], settings: { newPerDay: 20, desiredRetention: 0.9 }, learnHighlight: null }
}
function addCard(state: AppState, deckId: string, tag: string, front: string, back: string): string {
  const id = k++
  const ts = '2026-06-01T00:00:00Z'
  if (!state.decks.find((d) => d.id === deckId)) state.decks.push({ id: deckId, name: deckId, createdAt: ts, updatedAt: ts })
  const note = { id: `n${id}`, deckId, type: 'basic' as const, fields: { front, back }, tags: tag ? [tag] : [], createdAt: ts, updatedAt: ts }
  const card = { id: `c${id}`, noteId: note.id, deckId, ord: 0, createdAt: ts, updatedAt: ts }
  state.notes.push(note)
  state.cards.push(card)
  return card.id
}

const deterministicOpts = {
  spacingGap: 2,
  interleave: false,
  pretest: false,
  adaptiveLadder: false,
  fsrsReviewRungs: false,
  familiarity: 'some' as const,
  tabMode: 'manual' as const,
  seed: 42,
}

const adaptiveOpts = {
  ...deterministicOpts,
  tabMode: 'adaptive' as const,
  adaptiveLadder: true,
}

test('cardLadder: short answers climb mcq→blank→type; long answers use the recite trainer', () => {
  const s = emptyState()
  const a = addCard(s, 'd', 'x', 'Q1', 'Alpha')
  addCard(s, 'd', 'x', 'Q2', 'Bravo')
  addCard(s, 'd', 'x', 'Q3', 'Charlie')
  const cardA = s.cards.find((c) => c.id === a)!
  const noteA = s.notes.find((n) => n.id === cardA.noteId)!
  assert.deepEqual(cardLadder(s, cardA, noteA), ['mcq', 'blank', 'typed'])

  const longId = addCard(s, 'd', 'y', 'Recite the thing', 'x'.repeat(60))
  const cl = s.cards.find((c) => c.id === longId)!
  const nl = s.notes.find((n) => n.id === cl.noteId)!
  assert.deepEqual(cardLadder(s, cl, nl), ['passage'])
})

test('buildUnits groups by first concept tag', () => {
  const s = emptyState()
  addCard(s, 'd', 'a', 'q', 'A1')
  addCard(s, 'd', 'a', 'q', 'A2')
  addCard(s, 'd', 'b', 'q', 'B1')
  const units = buildUnits(s, s.cards.map((c) => c.id), { byConcept: true })
  assert.equal(units.length, 2)
  assert.equal(units[0].label, 'a')
  assert.equal(units[0].cardIds.length, 2)
  assert.equal(units[1].label, 'b')
  assert.equal(units[1].cardIds.length, 1)
})

test('buildPhases inserts synthesis for multi-card units and cumulative review', () => {
  const oneCard = [{ key: 'a', label: 'a', cardIds: ['c1'] }]
  const twoEach = [
    { key: 'a', label: 'a', cardIds: ['c1', 'c2'] },
    { key: 'b', label: 'b', cardIds: ['c3', 'c4'] },
    { key: 'c', label: 'c', cardIds: ['c5', 'c6'] },
  ]
  assert.deepEqual(buildPhases(oneCard), [{ kind: 'learn', unit: 0 }])
  assert.deepEqual(buildPhases(twoEach), [
    { kind: 'learn', unit: 0 },
    { kind: 'synthesis', unit: 0 },
    { kind: 'learn', unit: 1 },
    { kind: 'synthesis', unit: 1 },
    { kind: 'review', upTo: 1 },
    { kind: 'learn', unit: 2 },
    { kind: 'synthesis', unit: 2 },
    { kind: 'review', upTo: 2 },
  ])
  assert.deepEqual(buildPhases(twoEach, false), [
    { kind: 'learn', unit: 0 },
    { kind: 'learn', unit: 1 },
    { kind: 'review', upTo: 1 },
    { kind: 'learn', unit: 2 },
    { kind: 'review', upTo: 2 },
  ])
})

test('full session: two units master then a cumulative review, all cards mastered', () => {
  const s = emptyState()
  addCard(s, 'd', 'a', 'qa1', 'Alpha')
  addCard(s, 'd', 'a', 'qa2', 'Bravo')
  addCard(s, 'd', 'b', 'qb1', 'Charlie')
  addCard(s, 'd', 'b', 'qb2', 'Delta')
  let sess = startLearn(s, s.cards.map((c) => c.id), { byConcept: true, ...deterministicOpts })
  assert.equal(sess.units.length, 2)
  assert.equal(sess.phases.length, 5)

  const phasesSeen = new Set<number>()
  let guard = 0
  while (!sess.done && guard++ < 800) {
    phasesSeen.add(sess.phaseIndex)
    const cur = currentLearn(sess)
    if (cur?.unitSynthesis) {
      const unit = sess.units[cur.unitSynthesis.unitIndex]
      sess = answerUnitSynthesis(
        s,
        sess,
        unit.cardIds.map((id) => ({ cardId: id, passed: true })),
      )
      continue
    }
    sess = answerLearn(s, sess, true).session
    sess = tickLearnQueue(sess)
  }
  assert.ok(sess.done)
  assert.equal(sess.masteredCount, 4)
  assert.equal(sess.totalToMaster, 4)
  assert.ok(phasesSeen.has(0))
  assert.ok(phasesSeen.has(1))
})

test('startLearnFromUnits runs only the selected units (non-contiguous ok)', () => {
  const s = emptyState()
  addCard(s, 'd', 'a', 'qa1', 'Alpha')
  addCard(s, 'd', 'a', 'qa2', 'Bravo')
  addCard(s, 'd', 'b', 'qb1', 'Charlie')
  addCard(s, 'd', 'c', 'qc1', 'Delta')
  const all = buildUnits(s, s.cards.map((c) => c.id), { byConcept: true })
  assert.equal(all.length, 3)
  const picked = [all[2]]
  const sess = startLearnFromUnits(s, picked, deterministicOpts)
  assert.equal(sess.units.length, 1)
  assert.equal(sess.units[0].label, 'c')
  assert.equal(sess.totalToMaster, 1)
  assert.deepEqual(sess.phases, [{ kind: 'learn', unit: 0 }])
})

test('skipLearn defers a card without mastering; catch-up runs after phases end', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 'a', 'q', 'Alpha')
  let sess = startLearn(s, [id], deterministicOpts)
  assert.equal(currentLearn(sess)!.cardId, id)
  assert.equal(sess.deferred.length, 0)

  sess = skipLearn(s, sess)
  assert.equal(sess.deferred.length, 0)
  assert.equal(sess.queue.length, 1)
  assert.equal(sess.masteredCount, 0)
  assert.ok(sess.catchUp)
  assert.equal(currentLearn(sess)!.cardId, id)

  while (!sess.done && currentLearn(sess)) {
    sess = answerLearn(s, sess, true).session
    sess = tickLearnQueue(sess)
  }
  assert.ok(sess.done)
  assert.equal(sess.masteredCount, 1)
})

test('a wrong graded answer drops the card back one rung', () => {
  const s = emptyState()
  addCard(s, 'd', '', 'q', 'Alpha')
  let sess = startLearn(s, s.cards.map((c) => c.id), deterministicOpts)
  assert.equal(currentLearn(sess)!.rung, 0)
  const up = answerLearn(s, sess, true).session
  assert.equal(currentLearn(tickLearnQueue(up))!.rung, 1)
  const down = answerLearn(s, up, false).session
  assert.equal(currentLearn(tickLearnQueue(down))!.rung, 0)
})

test('within-session spacing: failed card waits before resurfacing', () => {
  const s = emptyState()
  const a = addCard(s, 'd', 'x', 'q1', 'Alpha')
  const b = addCard(s, 'd', 'x', 'q2', 'Bravo')
  let sess = startLearn(s, [a, b], { ...deterministicOpts, spacingGap: 2 })
  assert.equal(currentLearn(sess)!.cardId, a)
  // Pass mcq on A → goes to waiting; B should be next
  sess = answerLearn(s, sess, true).session
  sess = tickLearnQueue(sess)
  assert.equal(currentLearn(sess)!.cardId, b)
  // Fail on B → spaced; A should return from waiting before B retries
  sess = answerLearn(s, sess, false).session
  sess = tickLearnQueue(sess)
  assert.equal(currentLearn(sess)!.cardId, a)
})

test('adaptive ladder skips rungs when typed history is strong', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 't', 'q', 'Alpha')
  addCard(s, 'd', 't', 'q2', 'Bravo')
  addCard(s, 'd', 't', 'q3', 'Charlie')
  s.attempts = [
    { id: '1', cardId: id, mode: 'typed', correct: true, answeredAt: '2026-06-01T00:00:00Z', source: 'quiz' },
    { id: '2', cardId: id, mode: 'typed', correct: true, answeredAt: '2026-06-01T00:01:00Z', source: 'quiz' },
  ]
  const card = s.cards.find((c) => c.id === id)!
  const note = s.notes.find((n) => n.id === card.noteId)!
  const ladder = cardLadder(s, card, note)
  assert.equal(startRungFromHistory(s, id, ladder), ladder.indexOf('typed'))
})

test('pretest shows typed mode for brand-new cards', () => {
  const s = emptyState()
  addCard(s, 'd', 'x', 'q1', 'Alpha')
  addCard(s, 'd', 'x', 'q2', 'Bravo')
  addCard(s, 'd', 'x', 'q3', 'Charlie')
  const sess = startLearn(s, s.cards.map((c) => c.id).slice(0, 1), { ...deterministicOpts, pretest: true })
  const cur = currentLearn(sess)
  assert.ok(cur?.pretest)
  assert.equal(cur?.mode, 'typed')
})

test('blankCoverageForRung ramps from easy to base coverage', () => {
  const ladder = ['mcq', 'blank', 'typed'] as const
  const base = 0.6
  assert.ok(blankCoverageForRung(1, [...ladder], base) < base)
  assert.equal(blankCoverageForRung(2, [...ladder], base), base)
})

test('reviewRungFromFsrs starts low for never-reviewed cards', () => {
  const s = emptyState()
  const id = addCard(s, 'd', '', 'q', 'Alpha')
  const ladder = ['mcq', 'blank', 'typed'] as const
  assert.equal(reviewRungFromFsrs(s, id, [...ladder]), 0)
})

test('familiarityBaseBias increases from new to know', () => {
  assert.ok(familiarityBaseBias('some') > familiarityBaseBias('new'))
  assert.ok(familiarityBaseBias('know') > familiarityBaseBias('comfortable'))
})

test('familiarityStartRung maps to concrete ladder modes', () => {
  const full = ['mcq', 'blank', 'typed'] as const
  assert.equal(familiarityStartRung('new', [...full]), 0)
  assert.equal(familiarityStartRung('some', [...full]), 0)
  assert.equal(familiarityStartRung('comfortable', [...full]), 1)
  assert.equal(familiarityStartRung('know', [...full]), 2)

  const noBlank = ['mcq', 'typed'] as const
  assert.equal(familiarityStartRung('comfortable', [...noBlank]), 1)
  assert.equal(familiarityStartRung('know', [...noBlank]), 1)
})

test('adaptiveStartRung: know familiarity starts higher than new', () => {
  const s = emptyState()
  addCard(s, 'd', 'x', 'q1', 'Alpha')
  addCard(s, 'd', 'x', 'q2', 'Bravo')
  addCard(s, 'd', 'x', 'q3', 'Charlie')
  const units = buildUnits(s, s.cards.map((c) => c.id))
  const sessNew = startLearnFromUnits(s, units, { ...adaptiveOpts, familiarity: 'new' })
  const sessKnow = startLearnFromUnits(s, units, { ...adaptiveOpts, familiarity: 'know' })
  const ladder = ['mcq', 'blank', 'typed'] as const
  const phase = { kind: 'learn' as const, unit: 0 }
  const rungNew = adaptiveStartRung(s, s.cards[0].id, [...ladder], phase, sessNew)
  const rungKnow = adaptiveStartRung(s, s.cards[0].id, [...ladder], phase, sessKnow)
  assert.ok(rungKnow > rungNew)
  assert.equal(rungNew, 0)
  assert.equal(rungKnow, 2)
})

test('adaptiveStartRung: card data beats the familiarity answer (stale-perfect history → middle rung)', () => {
  // Per-card data-driven starts: the familiarity self-report only describes
  // unseen cards. A card with real (if stale) history starts from that data —
  // perfect answers from weeks ago are discounted to the middle rung.
  const s = emptyState()
  const id = addCard(s, 'd', 'x', 'q', 'Alpha')
  s.attempts.push({
    id: 'a1',
    cardId: id,
    mode: 'typed',
    correct: true,
    answeredAt: '2026-06-01T00:00:00Z',
    source: 'quiz',
  })
  s.attempts.push({
    id: 'a2',
    cardId: id,
    mode: 'typed',
    correct: true,
    answeredAt: '2026-06-02T00:00:00Z',
    source: 'quiz',
  })
  const units = buildUnits(s, [id])
  const sess = startLearnFromUnits(s, units, { ...adaptiveOpts, familiarity: 'new' })
  const ladder = ['mcq', 'blank', 'typed'] as const
  const phase = { kind: 'learn' as const, unit: 0 }
  assert.equal(adaptiveStartRung(s, id, [...ladder], phase, sess), 1)
})

test('brand new adaptive session pre-tests cards with no prior attempts', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 'x', 'q', 'Alpha')
  const units = buildUnits(s, [id])
  const sess = startLearnFromUnits(s, units, { ...adaptiveOpts, familiarity: 'new' })
  const cur = currentLearn(sess)
  assert.ok(cur?.pretest)
  assert.equal(cur?.mode, 'typed')
})

test('adaptiveStartRung: history skips rungs, discounted by staleness', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 'x', 'q', 'Alpha')
  // Stale perfect history (weeks old): skips mcq but not blank.
  for (let i = 0; i < 2; i++) {
    s.attempts.push({
      id: `a${i}`,
      cardId: id,
      mode: 'typed',
      correct: true,
      answeredAt: `2026-06-0${i + 1}T00:00:00Z`,
      source: 'quiz',
    })
  }
  const units = buildUnits(s, [id])
  const sess = startLearnFromUnits(s, units, { ...adaptiveOpts, familiarity: 'some' })
  const ladder = ['mcq', 'blank', 'typed'] as const
  const phase = { kind: 'learn' as const, unit: 0 }
  assert.equal(adaptiveStartRung(s, id, [...ladder], phase, sess), 1)

  // Fresh perfect history: straight to free recall.
  const s2 = emptyState()
  const id2 = addCard(s2, 'd', 'x', 'q', 'Alpha')
  for (let i = 0; i < 2; i++) {
    s2.attempts.push({
      id: `b${i}`,
      cardId: id2,
      mode: 'typed',
      correct: true,
      answeredAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      source: 'quiz',
    })
  }
  const units2 = buildUnits(s2, [id2])
  const sess2 = startLearnFromUnits(s2, units2, { ...adaptiveOpts, familiarity: 'some' })
  assert.equal(adaptiveStartRung(s2, id2, [...ladder], phase, sess2), 2)
})

test('difficultyBias rises after mastering a card', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 'x', 'q', 'Alpha')
  addCard(s, 'd', 'x', 'q2', 'Bravo')
  addCard(s, 'd', 'x', 'q3', 'Charlie')
  let sess = startLearn(s, [id], adaptiveOpts)
  assert.equal(sess.difficultyBias, 0)
  for (let i = 0; i < 2; i++) {
    sess = answerLearn(s, sess, true).session
    sess = tickLearnQueue(sess)
  }
  const { session: done } = answerLearn(s, sess, true)
  assert.ok(done.difficultyBias > 0)
  assert.equal(done.graduatedCardIds.length, 1)
})

test('manual learn does not ramp difficultyBias or coverageBias', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 'x', 'q', 'Alpha')
  addCard(s, 'd', 'x', 'q2', 'Bravo')
  addCard(s, 'd', 'x', 'q3', 'Charlie')
  let sess = startLearn(s, [id], deterministicOpts)
  for (let i = 0; i < 2; i++) {
    sess = answerLearn(s, sess, true).session
    sess = tickLearnQueue(sess)
  }
  const { session: done } = answerLearn(s, sess, true)
  assert.equal(done.difficultyBias, 0)
  assert.equal(done.coverageBias, 0.5)
})

test('learnBlankCoverage: manual uses fixed base; adaptive shifts with performance', () => {
  const ladder = ['mcq', 'blank', 'typed'] as const
  const base = 0.6
  const manual = startLearn(emptyState(), [], { tabMode: 'manual', seed: 1 })
  assert.equal(learnBlankCoverage(manual, 1, [...ladder], base), base)

  let adaptive = startLearn(emptyState(), [], { tabMode: 'adaptive', seed: 1 })
  const before = learnBlankCoverage(adaptive, 1, [...ladder], base)
  adaptive = { ...adaptive, coverageBias: 0.8 }
  const after = learnBlankCoverage(adaptive, 1, [...ladder], base)
  assert.ok(after > before)
})

test('coverageBias rises in adaptive mode after correct answers', () => {
  const s = emptyState()
  const id = addCard(s, 'd', 'x', 'q', 'Alpha')
  addCard(s, 'd', 'x', 'q2', 'Bravo')
  addCard(s, 'd', 'x', 'q3', 'Charlie')
  let sess = startLearn(s, [id], adaptiveOpts)
  assert.equal(sess.coverageBias, 0.5)
  sess = answerLearn(s, sess, true).session
  assert.ok(sess.coverageBias > 0.5)
})

test('answerLearn returns mastery event on top-rung pass', () => {
  const s = emptyState()
  const id = addCard(s, 'd', '', 'q', 'Alpha')
  addCard(s, 'd', '', 'q2', 'Bravo')
  addCard(s, 'd', '', 'q3', 'Charlie')
  let sess = startLearn(s, [id], deterministicOpts)
  // mcq → blank → typed
  for (let i = 0; i < 2; i++) {
    sess = answerLearn(s, sess, true).session
    sess = tickLearnQueue(sess)
  }
  const { session: done, mastery } = answerLearn(s, sess, true)
  assert.ok(mastery)
  assert.equal(mastery!.mode, 'typed')
  assert.equal(mastery!.phase, 'learn')
  assert.ok(done.masteredCount >= 1)
})