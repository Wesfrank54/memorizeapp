import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allOrderSlotsFilled,
  correctMatchIds,
  gradeOrder,
  initOrderPlacement,
  MATCH_CHALLENGES,
  matchChallengeById,
  matchPoolItems,
  slotsToOrder,
} from '../src/core/match-challenges.ts'

test('MATCH_CHALLENGES includes Navy and Marine collar and shoulder challenges', () => {
  assert.equal(MATCH_CHALLENGES.length, 4)
  assert.ok(matchChallengeById('navy-officer-collar'))
  assert.ok(matchChallengeById('navy-officer-shoulder'))
  assert.ok(matchChallengeById('marine-officer-collar'))
  assert.ok(matchChallengeById('marine-officer-shoulder'))
})

test('Navy challenges have 15 ranks; Marine challenges have 15 ranks (W-1 through O-10)', () => {
  for (const id of ['navy-officer-collar', 'navy-officer-shoulder']) {
    const c = matchChallengeById(id)!
    assert.equal(c.pairs.length, 15)
    assert.equal(c.branch, 'navy')
  }
  for (const id of ['marine-officer-collar', 'marine-officer-shoulder']) {
    const c = matchChallengeById(id)!
    assert.equal(c.pairs.length, 15)
    assert.equal(c.branch, 'marine')
    assert.ok(c.pairs.some((p) => p.rankCode === 'W-1 WO'))
    assert.ok(c.pairs.some((p) => p.rankCode === 'O-10 Gen'))
  }
})

test('Navy collar includes images; other challenges use text hints', () => {
  const navyCollar = matchChallengeById('navy-officer-collar')!
  const navyShoulder = matchChallengeById('navy-officer-shoulder')!
  const marineCollar = matchChallengeById('marine-officer-collar')!
  const marineShoulder = matchChallengeById('marine-officer-shoulder')!

  for (const p of navyCollar.pairs) {
    assert.ok(p.imageUrl?.includes('navy-officer-collar'), `${p.id} missing collar image`)
    assert.ok(p.insigniaHint)
  }

  for (const p of [navyShoulder, marineCollar, marineShoulder].flatMap((c) => c.pairs)) {
    assert.equal(p.imageUrl, undefined)
    assert.ok(p.insigniaHint && p.insigniaHint.length > 5)
  }
})

test('Marine collar and shoulder hints align with ODS rank structure', () => {
  const collar = matchChallengeById('marine-officer-collar')!
  const w1 = collar.pairs.find((p) => p.rankCode === 'W-1 WO')!
  assert.match(w1.insigniaHint!, /red background/i)
  assert.match(w1.insigniaHint!, /gold break/i)

  const shoulder = matchChallengeById('marine-officer-shoulder')!
  const o6 = shoulder.pairs.find((p) => p.rankCode === 'O-6 Col')!
  assert.match(o6.insigniaHint!, /shoulder board/i)
  assert.match(o6.insigniaHint!, /silver eagle/i)
})

test('match pool items align with pair ids and labels', () => {
  const marine = matchChallengeById('marine-officer-collar')!
  const pool = matchPoolItems(marine)
  assert.deepEqual(
    pool.map((i) => i.id),
    marine.pairs.map((p) => p.id),
  )
  assert.ok(pool.every((i) => i.label.includes('(')))
})

test('grading match placement uses per-slot correctness', () => {
  const collar = matchChallengeById('marine-officer-collar')!
  const correct = correctMatchIds(collar)
  const { pool, slots } = initOrderPlacement(correct, 42)
  assert.equal(pool.length, 15)
  assert.equal(allOrderSlotsFilled(slots), false)

  const filled = [...slots]
  const userOrder = [correct[1], correct[0], ...correct.slice(2)]
  for (let i = 0; i < userOrder.length; i++) filled[i] = userOrder[i]!

  const g = gradeOrder(slotsToOrder(filled), correct)
  assert.equal(g.perfect, false)
  assert.equal(g.correctPositions[0], false)
  assert.equal(g.correctPositions[1], false)
  assert.equal(g.correctPositions[2], true)
})

test('all match pair ids are unique', () => {
  const seen = new Set<string>()
  for (const c of MATCH_CHALLENGES) {
    for (const p of c.pairs) {
      assert.ok(!seen.has(p.id), `duplicate id ${p.id}`)
      seen.add(p.id)
    }
  }
})