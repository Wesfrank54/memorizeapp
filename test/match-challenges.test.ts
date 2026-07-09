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

test('MATCH_CHALLENGES includes collar and shoulder challenges', () => {
  assert.equal(MATCH_CHALLENGES.length, 2)
  assert.ok(matchChallengeById('navy-officer-collar'))
  assert.ok(matchChallengeById('navy-officer-shoulder'))
})

test('each match challenge has 15 rank pairs', () => {
  for (const c of MATCH_CHALLENGES) {
    assert.equal(c.pairs.length, 15)
    assert.equal(correctMatchIds(c).length, 15)
    assert.equal(matchPoolItems(c).length, 15)
  }
})

test('collar challenge includes image URLs; shoulder uses text hints', () => {
  const collar = matchChallengeById('navy-officer-collar')!
  const shoulder = matchChallengeById('navy-officer-shoulder')!

  assert.equal(collar.category, 'collar')
  assert.equal(shoulder.category, 'shoulder')

  for (const p of collar.pairs) {
    assert.ok(p.imageUrl?.includes('navy-officer-collar'), `${p.id} missing collar image`)
    assert.ok(p.insigniaHint)
    assert.match(p.rankLabel, /\(/)
  }

  for (const p of shoulder.pairs) {
    assert.equal(p.imageUrl, undefined)
    assert.ok(p.insigniaHint && p.insigniaHint.length > 10)
  }
})

test('match pool items align with pair ids and labels', () => {
  const collar = matchChallengeById('navy-officer-collar')!
  const pool = matchPoolItems(collar)
  assert.deepEqual(
    pool.map((i) => i.id),
    collar.pairs.map((p) => p.id),
  )
  assert.ok(pool.every((i) => i.label.includes('(')))
})

test('grading match placement uses per-slot correctness', () => {
  const collar = matchChallengeById('navy-officer-collar')!
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