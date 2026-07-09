/**
 * Merge all ODS deck CSVs into one deduplicated master file.
 * Run: node scripts/merge-ods-decks.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { csvToNotes } from '../src/core/csv.ts'
import { normalize } from '../src/core/grading.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const SOURCES = [
  { file: 'ODS_Knowledge_deck.csv', label: 'ODS Knowledge (core)' },
  { file: 'ODS_Ranks_Insignia_deck.csv', label: 'ODS Ranks & Insignia' },
  { file: 'ODS_Ranks_Demo_deck.csv', label: 'ODS Ranks Demo (images)' },
  { file: 'ODS_Galley_Procedures_deck.csv', label: 'ODS Galley Procedures' },
]

const OUT_NAME = 'ODS_Knowledge_Complete_deck.csv'
const MASTER_DECK = 'ODS Knowledge'

function dedupKey(note) {
  if (note.type === 'cloze') return `cloze|${normalize(note.text)}`
  const img = note.frontImage.trim()
  if (img) return `basic|img|${normalize(note.front)}|${img.toLowerCase()}`
  return `basic|${normalize(note.front)}`
}

function parseTags(tagStr) {
  if (!tagStr) return []
  return tagStr
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function mergeTags(a, b) {
  const set = new Set([...parseTags(a), ...parseTags(b)])
  return [...set].sort().join(',')
}

function scoreRow(note) {
  let s = 0
  if (note.frontImage) s += 4
  if (note.back?.length) s += 1
  if (note.tags.length) s += note.tags.length * 0.1
  return s
}

function mergeNotes(existing, incoming) {
  const pick = scoreRow(incoming) > scoreRow(existing) ? incoming : existing
  const other = pick === incoming ? existing : incoming
  return {
    ...pick,
    tags: [...new Set([...pick.tags, ...other.tags])],
    frontImage: pick.frontImage || other.frontImage,
    back: pick.back || other.back,
    text: pick.text || other.text,
  }
}

function escapeCsv(value) {
  const s = value ?? ''
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function noteToRow(note) {
  return [
    note.type,
    MASTER_DECK,
    note.front,
    note.back,
    note.text,
    note.frontImage,
    note.tags.join(','),
  ]
    .map(escapeCsv)
    .join(',')
}

function loadSource(relPath) {
  const full = path.join(root, relPath)
  if (!fs.existsSync(full)) {
    console.warn(`skip missing: ${relPath}`)
    return []
  }
  const text = fs.readFileSync(full, 'utf8')
  return csvToNotes(text)
}

const order = []
const byKey = new Map()
const stats = { added: 0, skipped: 0, merged: 0 }

for (const src of SOURCES) {
  const notes = loadSource(src.file)
  let srcAdded = 0
  let srcSkipped = 0
  for (const note of notes) {
    const key = dedupKey(note)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, note)
      order.push(key)
      stats.added++
      srcAdded++
    } else if (normalize(prev.back) === normalize(note.back) && prev.type === note.type) {
      byKey.set(key, mergeNotes(prev, note))
      stats.merged++
      srcSkipped++
    } else if (prev.type === 'basic' && note.type === 'basic' && note.frontImage && !prev.frontImage) {
      // Same question text, incoming has image — keep image variant key would differ; this branch is rare
      byKey.set(key, mergeNotes(prev, note))
      stats.merged++
      srcSkipped++
    } else {
      // True duplicate (same key, same answer)
      byKey.set(key, mergeNotes(prev, note))
      stats.merged++
      srcSkipped++
    }
  }
  console.log(`${src.label}: ${notes.length} rows → +${srcAdded} new, ${srcSkipped} merged/dup`)
}

const header = 'type,deck,front,back,text,image,tags'
const lines = [header, ...order.map((k) => noteToRow(byKey.get(k)))]
const outText = lines.join('\n') + '\n'

const outRoot = path.join(root, OUT_NAME)
const outPublic = path.join(root, 'public', 'decks', OUT_NAME)
fs.writeFileSync(outRoot, outText, 'utf8')
fs.mkdirSync(path.dirname(outPublic), { recursive: true })
fs.writeFileSync(outPublic, outText, 'utf8')

console.log(`\nWrote ${order.length} unique cards → ${OUT_NAME}`)
console.log(`  root: ${outRoot}`)
console.log(`  public: ${outPublic}`)
console.log(`  stats: ${stats.added} first-seen, ${stats.merged} tag/field merges`)