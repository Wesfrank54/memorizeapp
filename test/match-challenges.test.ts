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

test('MATCH_CHALLENGES includes Navy and Marine officer and enlisted challenges', () => {
  assert.equal(MATCH_CHALLENGES.length, 7)
  assert.ok(matchChallengeById('navy-officer-collar'))
  assert.ok(matchChallengeById('navy-officer-shoulder'))
  assert.ok(matchChallengeById('navy-enlisted-collar'))
  assert.ok(matchChallengeById('navy-enlisted-sleeve'))
  assert.ok(matchChallengeById('marine-officer-collar'))
  assert.ok(matchChallengeById('marine-officer-shoulder'))
  assert.ok(matchChallengeById('marine-enlisted-insignia'))
})

test('officer challenges have 15 ranks; enlisted counts match ODS structure', () => {
  for (const id of ['navy-officer-collar', 'navy-officer-shoulder', 'marine-officer-collar', 'marine-officer-shoulder']) {
    const c = matchChallengeById(id)!
    assert.equal(c.pairs.length, 15)
    assert.equal(c.personnel, 'officer')
  }
  for (const id of ['navy-enlisted-collar', 'navy-enlisted-sleeve']) {
    const c = matchChallengeById(id)!
    assert.equal(c.pairs.length, 10)
    assert.equal(c.branch, 'navy')
    assert.equal(c.personnel, 'enlisted')
    assert.ok(c.pairs.some((p) => p.rankCode === 'E-1 SR'))
    assert.ok(c.pairs.some((p) => p.rankCode === 'E-9 MCPON'))
  }
  const marineEnlisted = matchChallengeById('marine-enlisted-insignia')!
  assert.equal(marineEnlisted.pairs.length, 12)
  assert.equal(marineEnlisted.personnel, 'enlisted')
  assert.ok(marineEnlisted.pairs.some((p) => p.rankCode === 'E-8 1stSgt'))
  assert.ok(marineEnlisted.pairs.some((p) => p.rankCode === 'E-9 SMMC'))
})

test('Navy officer collar includes images; other challenges use text hints', () => {
  const navyCollar = matchChallengeById('navy-officer-collar')!
  const navyShoulder = matchChallengeById('navy-officer-shoulder')!
  const navyEnlistedCollar = matchChallengeById('navy-enlisted-collar')!
  const marineCollar = matchChallengeById('marine-officer-collar')!
  const marineShoulder = matchChallengeById('marine-officer-shoulder')!
  const marineEnlisted = matchChallengeById('marine-enlisted-insignia')!

  for (const p of navyCollar.pairs) {
    assert.ok(p.imageUrl?.includes('navy-officer-collar'), `${p.id} missing collar image`)
    assert.ok(p.insigniaHint)
  }

  for (const p of [
    navyShoulder,
    navyEnlistedCollar,
    matchChallengeById('navy-enlisted-sleeve')!,
    marineCollar,
    marineShoulder,
    marineEnlisted,
  ].flatMap((c) => c.pairs)) {
    assert.equal(p.imageUrl, undefined)
    assert.ok(p.insigniaHint && p.insigniaHint.length > 0)
  }
})

test('enlisted hints align with ODS insignia descriptions', () => {
  const navyCollar = matchChallengeById('navy-enlisted-collar')!
  const cpo = navyCollar.pairs.find((p) => p.rankCode === 'E-7 CPO')!
  assert.match(cpo.insigniaHint!, /rocker/i)

  const navySleeve = matchChallengeById('navy-enlisted-sleeve')!
  const mcpon = navySleeve.pairs.find((p) => p.rankCode === 'E-9 MCPON')!
  assert.match(mcpon.insigniaHint!, /fouled anchor/i)
  assert.match(mcpon.insigniaHint!, /gold star specialty/i)

  const marine = matchChallengeById('marine-enlisted-insignia')!
  const firstSgt = marine.pairs.find((p) => p.rankCode === 'E-8 1stSgt')!
  assert.match(firstSgt.insigniaHint!, /diamond/i)
  assert.doesNotMatch(firstSgt.insigniaHint!, /crossed rifles/i)

  const shoulder = matchChallengeById('marine-officer-shoulder')!
  const o6 = shoulder.pairs.find((p) => p.rankCode === 'O-6 Col')!
  assert.match(o6.insigniaHint!, /shoulder board/i)
  assert.match(o6.insigniaHint!, /silver eagle/i)
})

test('match pool items align with pair ids and labels', () => {
  const marine = matchChallengeById('marine-enlisted-insignia')!
  const pool = matchPoolItems(marine)
  assert.deepEqual(
    pool.map((i) => i.id),
    marine.pairs.map((p) => p.id),
  )
  assert.ok(pool.every((i) => i.label.includes('(')))
})

test('grading match placement uses per-slot correctness', () => {
  const collar = matchChallengeById('navy-enlisted-collar')!
  const correct = correctMatchIds(collar)
  const { pool, slots } = initOrderPlacement(correct, 42)
  assert.equal(pool.length, 10)
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