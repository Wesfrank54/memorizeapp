import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPassagePracticeRounds,
  firstLetterCue,
  gradePassageChunk,
  livePassageMarks,
  passageWantsFullRecall,
  selectBlanks,
  splitPassage,
} from '../src/core/passage.ts'

test('passageWantsFullRecall: substantial passages get the typed capstone, short clozes stay blanks-only', () => {
  const mission =
    'The mission of the Navy is to recruit, train, equip, and organize to deliver combat ready Naval forces to win conflicts and wars while maintaining security and deterrence through sustained forward presence.'
  assert.equal(passageWantsFullRecall(mission), true)
  assert.equal(passageWantsFullRecall('The capital of France is Paris.'), false)
})

test('single-chunk passage with full recall gets warm-up + full-line rounds before the capstone', () => {
  const rounds = buildPassagePracticeRounds(0.6, 1, true)
  assert.deepEqual(rounds.map((r) => r.title), ['Warm-up', 'Full line'])
  assert.equal(rounds[1].coverage, 1)
})

test('splitPassage breaks on sentence/line boundaries', () => {
  const creed = 'I am a United States Sailor. I proudly serve with honor, courage and commitment.'
  const chunks = splitPassage(creed)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0], 'I am a United States Sailor.')
})

test('splitPassage further splits a very long sentence at commas', () => {
  const long =
    'If I become a prisoner of war, I will keep faith with my fellow prisoners, I will give no information, I will obey the lawful orders of those appointed over me, and I will back them up.'
  const chunks = splitPassage(long)
  assert.ok(chunks.length >= 2, 'long sentence should be broken up')
  assert.ok(chunks.every((c) => c.split(' ').length <= 20))
})

test('firstLetterCue keeps first letters + punctuation', () => {
  assert.equal(firstLetterCue('I am a United States Sailor.'), 'I a a U S S.')
  assert.equal(firstLetterCue('Honor, Courage, Commitment'), 'H, C, C')
})

test('selectBlanks covers the right fraction of content words, evenly and deterministically', () => {
  const w10 = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']
  assert.equal(selectBlanks(w10, 0).size, 0)
  assert.equal(selectBlanks(w10, 1).size, 10)
  assert.equal(selectBlanks(w10, 0.6).size, 6)
  assert.equal(selectBlanks(w10, 0.3).size, 3)
  assert.deepEqual([...selectBlanks(w10, 0.6)], [...selectBlanks(w10, 0.6)]) // deterministic
  const picks = [...selectBlanks(w10, 0.5)].sort((a, b) => a - b)
  assert.ok(picks[picks.length - 1] >= 5, 'blanks should reach the back half')
})

test('selectBlanks rotates across variants so repeats blank different words', () => {
  const w = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'.split(' ')
  const v0 = [...selectBlanks(w, 0.5, 0)].sort((a, b) => a - b)
  const v1 = [...selectBlanks(w, 0.5, 1)].sort((a, b) => a - b)
  assert.equal(v0.length, v1.length) // same coverage
  assert.notDeepEqual(v0, v1) // different words tested
  // over several variants the union covers more than any single pass
  const union = new Set<number>()
  for (let v = 0; v < 6; v++) for (const i of selectBlanks(w, 0.5, v)) union.add(i)
  assert.ok(union.size > v0.length)
})

test('selectBlanks returns positions in reading order (leftmost first), even when rotated', () => {
  const w = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'.split(' ')
  for (let v = 0; v < 6; v++) {
    const picks = [...selectBlanks(w, 0.5, v)]
    assert.deepEqual(picks, [...picks].sort((a, b) => a - b), `variant ${v} should be ascending`)
  }
})

test('selectBlanks skips function words (a/of/to/the...) — blanks land on content words', () => {
  const words = 'The powerhouse of the cell is the mitochondria'.split(' ')
  const blanked = [...selectBlanks(words, 1)].map((i) => words[i].toLowerCase())
  assert.ok(!blanked.includes('the') && !blanked.includes('of') && !blanked.includes('is'))
  assert.ok(blanked.includes('powerhouse') && blanked.includes('cell') && blanked.includes('mitochondria'))
})

test('buildPassagePracticeRounds adds graduated buildup before full recall', () => {
  const single = buildPassagePracticeRounds(0.8, 1, true)
  assert.equal(single.length, 2)
  assert.ok(single[0].coverage < single[1].coverage)

  const multi = buildPassagePracticeRounds(0.8, 3, true)
  assert.ok(multi.length >= 4)
  assert.equal(multi[0].kind, 'lines')
  assert.equal(multi[multi.length - 1].kind, 'cumulative')
  assert.ok(multi[0].coverage < multi[1].coverage)
  assert.ok(multi[1].coverage < multi[2].coverage)

  const long = buildPassagePracticeRounds(0.8, 6, true)
  assert.equal(long.filter((r) => r.kind === 'cumulative').length, 2)

  const noFull = buildPassagePracticeRounds(0.6, 5, false)
  assert.deepEqual(noFull, [{ kind: 'lines', coverage: 0.6, title: 'Recall' }])
})

test('livePassageMarks colors complete words and the word in progress', () => {
  const expected = 'I am a United States Sailor'
  assert.deepEqual(livePassageMarks(expected, 'I am '), [
    { text: 'I', ok: true },
    { text: 'am', ok: true },
  ])
  assert.deepEqual(livePassageMarks(expected, 'I am a Uni'), [
    { text: 'I', ok: true },
    { text: 'am', ok: true },
    { text: 'a', ok: true },
    { text: 'Uni', ok: true },
  ])
  const wrong = livePassageMarks(expected, 'I am a Sail')
  assert.equal(wrong[3]?.text, 'Sail')
  assert.equal(wrong[3]?.ok, false)
})

test('gradePassageChunk marks words positionally and counts correct', () => {
  const r = gradePassageChunk('I am a United States Sailor', 'I am a united states sailor')
  assert.equal(r.total, 6)
  assert.equal(r.correct, 6) // case + normalization ignored
  assert.ok(r.marks.every((m) => m.ok))

  const wrong = gradePassageChunk('Take charge of this post', 'Take charge of the post')
  assert.equal(wrong.correct, 4) // "the" != "this"
  assert.equal(wrong.marks[3].ok, false)
  assert.equal(wrong.marks[3].text, 'this')
})
