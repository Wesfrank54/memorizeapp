import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allOrderSlotsFilled,
  correctOrderIds,
  gradeOrder,
  initOrderPlacement,
  moveOrderId,
  orderChallengeById,
  ORDER_CHALLENGES,
  placeOrderItem,
  returnOrderItemToPool,
  shuffleOrderIds,
  slotsToOrder,
} from '../src/core/order-challenges.ts'

test('ORDER_CHALLENGES includes General Orders, chain of command, and ranks', () => {
  assert.ok(orderChallengeById('general-orders-sentry'))
  assert.ok(orderChallengeById('chain-of-command-ods'))
  assert.ok(orderChallengeById('navy-officer-ranks'))
  assert.equal(orderChallengeById('general-orders-sentry')!.items.length, 11)
  assert.equal(orderChallengeById('chain-of-command-ods')!.items.length, 15)
})

test('shuffleOrderIds permutes but never returns identical order when length > 1', () => {
  const ids = ['a', 'b', 'c', 'd']
  const shuffled = shuffleOrderIds(ids, 42)
  assert.deepEqual([...shuffled].sort(), ids)
  assert.notDeepEqual(shuffled, ids)
})

test('gradeOrder scores per-slot correctness', () => {
  const correct = ['a', 'b', 'c']
  const user = ['a', 'c', 'b']
  const g = gradeOrder(user, correct)
  assert.equal(g.perfect, false)
  assert.equal(g.wrongCount, 2)
  assert.deepEqual(g.correctPositions, [true, false, false])
  assert.equal(g.score, 1 / 3)
})

test('moveOrderId reorders list', () => {
  assert.deepEqual(moveOrderId(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'])
  assert.deepEqual(moveOrderId(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
})

test('initOrderPlacement shuffles pool and clears slots', () => {
  const correct = ['a', 'b', 'c']
  const { pool, slots } = initOrderPlacement(correct, 42)
  assert.deepEqual([...pool].sort(), correct)
  assert.notDeepEqual(pool, correct)
  assert.deepEqual(slots, [null, null, null])
  assert.equal(allOrderSlotsFilled(slots), false)
})

test('placeOrderItem moves from pool into slot and swaps between slots', () => {
  let pool = ['a', 'b', 'c']
  let slots: (string | null)[] = [null, null, null]

  ;({ pool, slots } = placeOrderItem(pool, slots, { kind: 'pool' }, 'b', 1))
  assert.deepEqual(pool, ['a', 'c'])
  assert.deepEqual(slots, [null, 'b', null])

  ;({ pool, slots } = placeOrderItem(pool, slots, { kind: 'pool' }, 'a', 0))
  assert.deepEqual(pool, ['c'])
  assert.deepEqual(slots, ['a', 'b', null])

  ;({ pool, slots } = placeOrderItem(pool, slots, { kind: 'slot', index: 0 }, 'a', 1))
  assert.deepEqual(pool, ['c'])
  assert.deepEqual(slots, ['b', 'a', null])

  ;({ pool, slots } = placeOrderItem(pool, slots, { kind: 'pool' }, 'c', 2))
  assert.deepEqual(pool, [])
  assert.deepEqual(slots, ['b', 'a', 'c'])
  assert.equal(allOrderSlotsFilled(slots), true)
  assert.deepEqual(slotsToOrder(slots), ['b', 'a', 'c'])
})

test('returnOrderItemToPool moves a placed item back to the pool', () => {
  const pool: string[] = ['c']
  const slots: (string | null)[] = ['a', 'b', null]
  const next = returnOrderItemToPool(pool, slots, 1)
  assert.deepEqual(next.pool, ['c', 'b'])
  assert.deepEqual(next.slots, ['a', null, null])
})

test('general orders challenge matches ODS deck count', () => {
  const go = orderChallengeById('general-orders-sentry')!
  assert.equal(correctOrderIds(go).length, 11)
  assert.match(go.items[0]!.label, /Take charge/)
  assert.match(go.items[10]!.label, /watchful at night/i)
})

test('all challenges have unique item ids', () => {
  const seen = new Set<string>()
  for (const c of ORDER_CHALLENGES) {
    for (const item of c.items) {
      assert.ok(!seen.has(item.id), `duplicate id ${item.id}`)
      seen.add(item.id)
    }
  }
})