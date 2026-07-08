import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerShape,
  canonicalMcqGroup,
  mcqAnswerGroup,
  sameMcqGroup,
  sameShape,
  synthesizeDistractors,
} from '../src/core/distractors.ts'
import { makeChoices } from '../src/core/grading.ts'
import { mcqIsWorthwhile } from '../src/core/answer-modes.ts'
import { cardLadder } from '../src/core/learn.ts'
import type { AppState } from '../src/core/types.ts'

function emptyState(): AppState {
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

function addBasic(state: AppState, deckId: string, tag: string, front: string, back: string) {
  const id = `c${state.cards.length}`
  const ts = '2026-06-01T00:00:00Z'
  if (!state.decks.find((d) => d.id === deckId)) {
    state.decks.push({ id: deckId, name: deckId, createdAt: ts, updatedAt: ts })
  }
  const note = { id: `n${id}`, deckId, type: 'basic' as const, fields: { front, back }, tags: tag ? [tag] : [], createdAt: ts, updatedAt: ts }
  const card = { id, noteId: note.id, deckId, ord: 0, createdAt: ts, updatedAt: ts }
  state.notes.push(note)
  state.cards.push(card)
  return { card, note }
}

const DATE_RE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/

test('answerShape classifies dates, years, quantities, text', () => {
  assert.equal(answerShape('13 October 1775').kind, 'date')
  assert.equal(answerShape('October 13, 1775').kind, 'date')
  assert.equal(answerShape('Oct 13, 1775').kind, 'date')
  assert.equal(answerShape('October 1775').kind, 'date')
  assert.equal(answerShape('1775').kind, 'year')
  assert.equal(answerShape('11').kind, 'number')
  assert.equal(answerShape('36 inches').kind, 'number')
  assert.equal(answerShape('Honor, Courage, Commitment').kind, 'text')
  assert.equal(answerShape('The Nile').kind, 'text')
})

test('synthesizeDistractors: dates keep the exact format, differ from the answer, unique', () => {
  const out = synthesizeDistractors('13 October 1775', 3, 'seed-a')
  assert.equal(out.length, 3)
  for (const o of out) {
    assert.match(o, DATE_RE, `format preserved: ${o}`)
    assert.notEqual(o, '13 October 1775')
  }
  assert.equal(new Set(out).size, 3)
})

test('synthesizeDistractors: mdy format with comma preserved', () => {
  const out = synthesizeDistractors('October 13, 1775', 3, 'seed-b')
  for (const o of out) assert.match(o, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/, o)
})

test('synthesizeDistractors: deterministic for the same seed, varies by seed', () => {
  const a1 = synthesizeDistractors('13 October 1775', 3, 'card-1')
  const a2 = synthesizeDistractors('13 October 1775', 3, 'card-1')
  assert.deepEqual(a1, a2)
  const b = synthesizeDistractors('13 October 1775', 3, 'card-2')
  assert.notDeepEqual(a1, b)
})

test('synthesizeDistractors: years stay 4-digit years; counts stay positive with unit kept', () => {
  for (const y of synthesizeDistractors('1775', 3, 's')) assert.match(y, /^\d{4}$/)
  for (const q of synthesizeDistractors('11', 3, 's')) {
    assert.match(q, /^\d+$/)
    assert.ok(Number(q) > 0)
    assert.notEqual(q, '11')
  }
  for (const u of synthesizeDistractors('36 inches', 3, 's')) assert.match(u, /^\d+ inches$/)
})

test('synthesizeDistractors: plain text yields nothing (real cards remain the source)', () => {
  assert.deepEqual(synthesizeDistractors('The Nile', 3, 's'), [])
})

test('sameShape: dates match dates; units must match for quantities', () => {
  assert.equal(sameShape('13 October 1775', '10 November 1775'), true)
  assert.equal(sameShape('13 October 1775', 'The Nile'), false)
  assert.equal(sameShape('11', '36 inches'), false)
  assert.equal(sameShape('36 inches', '30 inches'), true)
})

test('Navy birthday: all MCQ options are dates even in a prose deck', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'navy', 'facts', "When is the Navy's birthday?", '13 October 1775')
  addBasic(s, 'navy', 'facts', 'First CNO?', 'Admiral William Benson')
  addBasic(s, 'navy', 'facts', 'Navy motto?', 'Semper Fortis')
  addBasic(s, 'navy', 'facts', 'Father of the Navy?', 'John Paul Jones')
  const opts = makeChoices(s, card, note, 4)
  assert.equal(opts.length, 4)
  assert.equal(opts[0], '13 October 1775')
  for (const o of opts) assert.equal(answerShape(o).kind, 'date', `every option is a date: ${o}`)
  assert.ok(!opts.includes('Semper Fortis'))
})

test('Navy birthday: a real same-shape fact (Marine birthday) is preferred as a distractor', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'navy', 'facts', "When is the Navy's birthday?", '13 October 1775')
  addBasic(s, 'navy', 'facts', "When is the Marine Corps' birthday?", '10 November 1775')
  addBasic(s, 'navy', 'facts', 'Navy motto?', 'Semper Fortis')
  const opts = makeChoices(s, card, note, 4)
  assert.ok(opts.includes('10 November 1775'), 'real confusable date included')
  for (const o of opts) assert.equal(answerShape(o).kind, 'date')
})

test('mcqIsWorthwhile: date and bare-count facts now qualify; article labels still do not', () => {
  const s = emptyState()
  const bday = addBasic(s, 'navy', 'facts', "When is the Navy's birthday?", '13 October 1775')
  const count = addBasic(s, 'navy', 'facts', 'How many general orders are there?', '11')
  const art = addBasic(s, 'navy', 'coc', 'Which article covers escape?', 'Article 3')
  addBasic(s, 'navy', 'facts', 'Navy motto?', 'Semper Fortis')
  assert.equal(mcqIsWorthwhile(s, bday.card, bday.note, "When is the Navy's birthday?", '13 October 1775'), true)
  assert.equal(mcqIsWorthwhile(s, count.card, count.note, 'How many general orders are there?', '11'), true)
  assert.equal(mcqIsWorthwhile(s, art.card, art.note, 'Which article covers escape?', 'Article 3'), false)
})

test('canonicalMcqGroup unifies ranks-marine-enlisted and marine-enlisted-rank', () => {
  assert.equal(canonicalMcqGroup('ranks-marine-enlisted'), 'marine-enlisted-rank')
  assert.equal(canonicalMcqGroup('marine-enlisted-rank'), 'marine-enlisted-rank')
  assert.equal(sameMcqGroup('ranks-marine-enlisted', 'marine-enlisted-rank'), true)
})

test('makeChoices: duplicate rank imports from both decks still get distractors', () => {
  const s = emptyState()
  addBasic(s, 'ranks', 'marine-enlisted-rank', 'Marine enlisted rank — E-2?', 'Private First Class (PFC)')
  addBasic(s, 'ranks', 'marine-enlisted-rank', 'Marine enlisted rank — E-3?', 'Lance Corporal (LCpl)')
  addBasic(s, 'ranks', 'marine-enlisted-rank', 'Marine enlisted rank — E-4?', 'Corporal (Cpl)')
  addBasic(s, 'ranks', 'marine-enlisted-rank', 'Marine enlisted rank — E-5?', 'Sergeant (Sgt)')
  const { card, note } = addBasic(
    s,
    'marine',
    'ranks-marine-enlisted',
    'Marine enlisted rank — E-1?',
    'Private (Pvt)',
  )
  addBasic(s, 'marine', 'ranks-marine-enlisted', 'Marine enlisted rank — E-2?', 'Private First Class (PFC)')
  addBasic(s, 'marine', 'ranks-marine-enlisted', 'Marine enlisted rank — E-3?', 'Lance Corporal (LCpl)')
  addBasic(s, 'marine', 'ranks-marine-enlisted', 'Marine enlisted rank — E-4?', 'Corporal (Cpl)')

  const opts = makeChoices(s, card, note, 4)
  assert.equal(opts.length, 4, 'mixed-tag duplicate imports should still yield 4 MCQ options')
  assert.ok(opts.includes('Private (Pvt)'))
})

test('mcqAnswerGroup: rank tags differ from collar/shoulder tags', () => {
  assert.equal(mcqAnswerGroup(['navy-officer-rank'], 'Navy officer rank — O-7?', 'Rear Admiral Lower Half (RDML)'), 'navy-officer-rank')
  assert.equal(mcqAnswerGroup(['navy-officer-collar'], 'Navy officer collar device — O-7 RDML?', 'One silver five-pointed star'), 'navy-officer-collar')
  assert.equal(
    sameMcqGroup('navy-officer-rank', 'navy-officer-collar'),
    false,
    'rank and collar are different MCQ groups',
  )
  assert.equal(sameMcqGroup('navy-officer-rank', 'marine-officer-rank'), true, 'rank family matches across branches')
})

test('makeChoices: navy officer rank only draws other rank titles, not collar devices', () => {
  const s = emptyState()
  const { card, note } = addBasic(
    s,
    'ranks',
    'navy-officer-rank',
    'Navy officer rank — O-7?',
    'Rear Admiral Lower Half (RDML)',
  )
  addBasic(s, 'ranks', 'navy-officer-rank', 'Navy officer rank — O-8?', 'Rear Admiral (RADM)')
  addBasic(s, 'ranks', 'navy-officer-rank', 'Navy officer rank — O-9?', 'Vice Admiral (VADM)')
  addBasic(s, 'ranks', 'navy-officer-rank', 'Navy officer rank — O-10?', 'Admiral (ADM)')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — W-3 CWO3?', 'Silver bar with two blue breaks')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — W-4 CWO4?', 'Silver bar with three blue breaks')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — W-2 CWO2?', 'Gold bar with three blue breaks')

  const opts = makeChoices(s, card, note, 4)
  assert.equal(opts.length, 4)
  assert.ok(opts.includes('Rear Admiral Lower Half (RDML)'))
  for (const o of opts) {
    assert.ok(!/bar with/i.test(o), `collar device excluded: ${o}`)
    assert.ok(RANK_OR_ADMIRAL.test(o) || o === 'Rear Admiral Lower Half (RDML)', `expected rank title: ${o}`)
  }
})

const RANK_OR_ADMIRAL = /\b(?:admiral|lieutenant|captain|ensign|commander|warrant officer|chief warrant)\b/i

test('mcqIsWorthwhile: insignia and phonetic cards qualify when same-group distractors exist', () => {
  const s = emptyState()
  const collar = addBasic(
    s,
    'ranks',
    'navy-officer-collar',
    'Navy officer collar device — W-2 CWO2?',
    'Gold bar with three blue breaks',
  )
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — W-3 CWO3?', 'Silver bar with two blue breaks')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — W-4 CWO4?', 'Silver bar with three blue breaks')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — O-1 ENS?', 'One gold bar')
  const phon = addBasic(s, 'ods', 'phonetic-alphabet', 'Phonetic alphabet — A?', 'Alpha')
  addBasic(s, 'ods', 'phonetic-alphabet', 'Phonetic alphabet — B?', 'Bravo')
  addBasic(s, 'ods', 'phonetic-alphabet', 'Phonetic alphabet — C?', 'Charlie')
  addBasic(s, 'ods', 'phonetic-alphabet', 'Phonetic alphabet — D?', 'Delta')
  assert.equal(
    mcqIsWorthwhile(s, collar.card, collar.note, 'Navy officer collar device — W-2 CWO2?', 'Gold bar with three blue breaks'),
    true,
  )
  assert.equal(mcqIsWorthwhile(s, phon.card, phon.note, 'Phonetic alphabet — A?', 'Alpha'), true)
})

test('makeChoices: navy officer collar device only draws other collar devices', () => {
  const s = emptyState()
  const { card, note } = addBasic(
    s,
    'ranks',
    'navy-officer-collar',
    'Navy officer collar device — O-7 RDML?',
    'One silver five-pointed star',
  )
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — O-8 RADM?', 'Two silver five-pointed stars')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — O-9 VADM?', 'Three silver five-pointed stars')
  addBasic(s, 'ranks', 'navy-officer-collar', 'Navy officer collar device — O-1 ENS?', 'One gold bar')
  addBasic(s, 'ranks', 'navy-officer-rank', 'Navy officer rank — O-7?', 'Rear Admiral Lower Half (RDML)')
  addBasic(s, 'ranks', 'navy-officer-rank', 'Navy officer rank — O-8?', 'Rear Admiral (RADM)')

  const opts = makeChoices(s, card, note, 4)
  assert.equal(opts.length, 4)
  assert.ok(opts.includes('One silver five-pointed star'))
  for (const o of opts) {
    assert.ok(!RANK_OR_ADMIRAL.test(o), `rank title excluded: ${o}`)
  }
})

test('cardLadder: date card climbs mcq → typed (blank stays off — digits leak)', () => {
  const s = emptyState()
  const { card, note } = addBasic(s, 'navy', 'facts', "When is the Navy's birthday?", '13 October 1775')
  addBasic(s, 'navy', 'facts', 'Navy motto?', 'Semper Fortis')
  assert.deepEqual(cardLadder(s, card, note), ['mcq', 'typed'])
})
