import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_FRONT_IMAGE, resolveMediaUrl } from '../src/core/media.ts'
import { renderContent } from '../src/core/schedule.ts'
import { ensureImageDemoDeck, imageDemoItems } from '../src/core/image-demo.ts'
import { getState } from '../src/core/store.ts'
import type { Card, Note } from '../src/core/types.ts'

test('resolveMediaUrl: relative public paths and absolute URLs', () => {
  assert.equal(resolveMediaUrl('insignia/o4.svg'), '/insignia/o4.svg')
  assert.equal(resolveMediaUrl('/insignia/o4.svg'), '/insignia/o4.svg')
  assert.equal(resolveMediaUrl('https://cdn.example.com/x.png'), 'https://cdn.example.com/x.png')
  assert.equal(resolveMediaUrl(''), undefined)
})

test('renderContent includes questionImage from frontImage field', () => {
  const note: Note = {
    id: 'n1',
    deckId: 'd1',
    type: 'basic',
    fields: {
      front: 'What rank wears this collar device?',
      back: 'Lieutenant Commander (LCDR)',
      [FIELD_FRONT_IMAGE]: 'insignia/navy-officer-collar/o4-lcdr.svg',
    },
    tags: ['navy-officer-rank'],
    createdAt: 'x',
    updatedAt: 'x',
  }
  const card: Card = { id: 'c1', noteId: 'n1', deckId: 'd1', ord: 0, createdAt: 'x', updatedAt: 'x' }
  const out = renderContent(note, card)
  assert.equal(out.questionImage, '/insignia/navy-officer-collar/o4-lcdr.svg')
  assert.equal(out.answer, 'Lieutenant Commander (LCDR)')
})

test('ensureImageDemoDeck adds image cards idempotently', () => {
  ensureImageDemoDeck()
  const first = imageDemoItems(getState()).length
  ensureImageDemoDeck()
  const second = imageDemoItems(getState()).length
  assert.ok(first >= 3)
  assert.equal(second, first)
})