import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLearnSettings,
  patchStateFromFsrsParams,
  parseFsrsParamsRow,
  serializeLearnSettings,
} from '../src/core/fsrs-params.ts'
import { mergeLearnHighlightRemote } from '../src/core/learn.ts'

function emptyState() {
  return {
    decks: [],
    notes: [],
    cards: [],
    events: [],
    tombstones: [],
    commitments: [],
    checkpoints: [],
    attempts: [],
    settings: { newPerDay: 20, desiredRetention: 0.9 },
    learnHighlight: null,
  }
}

test('parseFsrsParamsRow parses weights and learn highlight JSON', () => {
  const row = parseFsrsParamsRow({
    weights: '[1,2,3]',
    desiredRetention: 0.85,
    learnHighlightCardIds: '["c1","c2"]',
    learnHighlightSetAt: '2026-07-06T12:00:00Z',
  })
  assert.deepEqual(row.weights, [1, 2, 3])
  assert.equal(row.desiredRetention, 0.85)
  assert.deepEqual(row.learnHighlightCardIds, ['c1', 'c2'])
  assert.equal(row.learnHighlightSetAt, '2026-07-06T12:00:00Z')
})

test('mergeLearnHighlightRemote keeps newer setAt across devices', () => {
  const local = { cardIds: ['a'], setAt: '2026-07-06T10:00:00Z' }
  const remote = { cardIds: ['b', 'c'], setAt: '2026-07-06T14:00:00Z' }
  const at = new Date('2026-07-06T15:00:00Z')
  assert.deepEqual(mergeLearnHighlightRemote(local, remote, at)?.cardIds, ['b', 'c'])
  assert.deepEqual(mergeLearnHighlightRemote(remote, local, at)?.cardIds, ['b', 'c'])
})

test('serializeLearnSettings round-trips learn prefs', () => {
  const json = serializeLearnSettings({
    newPerDay: 20,
    desiredRetention: 0.9,
    learnSpacingGap: 3,
    learnInterleave: false,
    blankCoverage: 0.5,
  })
  const parsed = parseLearnSettings(json)
  assert.equal(parsed.learnSpacingGap, 3)
  assert.equal(parsed.learnInterleave, false)
  assert.equal(parsed.blankCoverage, 0.5)
})

test('patchStateFromFsrsParams applies learn settings JSON', () => {
  const s = emptyState()
  const next = patchStateFromFsrsParams(s, {
    learnSettingsJson: JSON.stringify({ learnSpacingGap: 4, learnPretest: true }),
  })
  assert.equal(next.settings.learnSpacingGap, 4)
  assert.equal(next.settings.learnPretest, true)
})

test('patchStateFromFsrsParams applies remote learn highlight', () => {
  const s = emptyState()
  const next = patchStateFromFsrsParams(s, {
    learnHighlightCardIds: ['x'],
    learnHighlightSetAt: new Date().toISOString(),
  })
  assert.deepEqual(next.learnHighlight?.cardIds, ['x'])
})