import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderChallengeById } from '../src/core/order-challenges.ts'
import { orderLayoutProfile } from '../src/core/order-layout.ts'

test('orderLayoutProfile: general orders use ultra density and multi-column', () => {
  const items = orderChallengeById('general-orders-sentry')!.items
  const p = orderLayoutProfile(items)
  assert.equal(p.density, 'ultra')
  assert.equal(p.lineClamp, 3)
  assert.ok(p.slotCols >= 3)
  assert.equal(p.maxCols, 7)
  assert.equal(p.slotRows, Math.ceil(items.length / p.slotCols))
})

test('orderLayoutProfile: chain of command uses compact+ columns for 15 items', () => {
  const items = orderChallengeById('chain-of-command-ods')!.items
  const p = orderLayoutProfile(items)
  assert.equal(p.density, 'compact')
  assert.ok(p.slotCols >= 3)
  assert.ok(p.maxCols >= 4)
})

test('orderLayoutProfile: rank decks use normal or compact', () => {
  const items = orderChallengeById('navy-officer-ranks')!.items
  const p = orderLayoutProfile(items)
  assert.ok(p.slotCols >= 3)
  assert.equal(p.slotRows, Math.ceil(16 / p.slotCols))
})