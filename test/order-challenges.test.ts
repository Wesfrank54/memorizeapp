import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  correctOrderIds,
  gradeOrder,
  moveOrderId,
  orderChallengeById,
  ORDER_CHALLENGES,
  shuffleOrderIds,
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