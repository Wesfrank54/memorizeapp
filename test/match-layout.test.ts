import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchPoolItems, matchChallengeById } from '../src/core/match-challenges.ts'
import { matchLayoutProfile } from '../src/core/match-layout.ts'

test('matchLayoutProfile: collar favors 3+ columns', () => {
  const items = matchPoolItems(matchChallengeById('navy-officer-collar')!)
  const p = matchLayoutProfile(items, 'collar')
  assert.ok(p.minCols >= 3)
  assert.ok(p.maxCols >= 4)
  assert.equal(p.lineClamp, 2)
})

test('matchLayoutProfile: shoulder uses fewer columns for text hints', () => {
  const items = matchPoolItems(matchChallengeById('navy-officer-shoulder')!)
  const p = matchLayoutProfile(items, 'shoulder')
  assert.equal(p.minCols, 2)
  assert.ok(p.maxCols <= 3)
  assert.equal(p.slotRows, Math.ceil(15 / p.slotCols))
})