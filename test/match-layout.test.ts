import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchPoolItems, matchChallengeById } from '../src/core/match-challenges.ts'
import { matchLayoutProfile } from '../src/core/match-layout.ts'

test('matchLayoutProfile: collar uses moderate columns for larger cells', () => {
  const items = matchPoolItems(matchChallengeById('navy-officer-collar')!)
  const p = matchLayoutProfile(items, 'collar')
  assert.equal(p.minCols, 3)
  assert.equal(p.maxCols, 5)
  assert.equal(p.maxPoolCols, 7)
  assert.equal(p.lineClamp, 2)
})

test('matchLayoutProfile: shoulder uses two wide columns for long descriptions', () => {
  const items = matchPoolItems(matchChallengeById('navy-officer-shoulder')!)
  const p = matchLayoutProfile(items, 'shoulder')
  assert.equal(p.minCols, 2)
  assert.equal(p.maxCols, 2)
  assert.equal(p.maxPoolCols, 4)
  assert.equal(p.slotRows, Math.ceil(15 / p.slotCols))
})