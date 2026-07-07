import fs from 'fs'
import path from 'path'
import os from 'os'
import { ClassicLevel } from 'classic-level'

const ldbDir = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Google/Chrome/User Data/Default/Local Storage/leveldb',
)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memorize-ls-'))
for (const f of fs.readdirSync(ldbDir)) {
  if (f === 'LOCK') continue
  try {
    fs.copyFileSync(path.join(ldbDir, f), path.join(tmp, f))
  } catch {
    // skip
  }
}

const db = new ClassicLevel(tmp, { createIfMissing: false, compression: false })
const entries = []
for await (const [key, value] of db.iterator()) {
  const ks = key.toString('latin1')
  if (!ks.includes('memorize-app-v1')) continue
  entries.push({ key: ks, value })
}
await db.close()
fs.rmSync(tmp, { recursive: true, force: true })

function decodeValue(buf) {
  const attempts = []
  attempts.push(buf.toString('utf8'))
  attempts.push(buf.toString('latin1'))

  let utf16 = ''
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8)
    if (code === 0) break
    if (code >= 0x20 && code <= 0x10ffff) utf16 += String.fromCodePoint(code)
  }
  attempts.push(utf16)

  // Chromium sometimes prefixes metadata bytes before UTF-16 JSON
  const marker = Buffer.from('{"decks":', 'utf16le')
  const idx = buf.indexOf(marker)
  if (idx >= 0) {
    let s = ''
    for (let i = idx; i < buf.length - 1; i += 2) {
      const code = buf[i] | (buf[i + 1] << 8)
      if (code === 0) break
      s += String.fromCodePoint(code)
    }
    attempts.push(s)
  }

  for (const text of attempts) {
    const start = text.indexOf('{"decks":')
    if (start < 0) continue
    let depth = 0
    for (let j = start; j < text.length; j++) {
      const c = text[j]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, j + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}

let data = null
let origin = null
for (const e of entries) {
  const parsed = decodeValue(Buffer.isBuffer(e.value) ? e.value : Buffer.from(e.value))
  if (parsed?.decks?.length) {
    data = parsed
    const m = e.key.match(/https?:\/\/[^\x00]+/)
    origin = m ? m[0] : e.key.slice(0, 120)
    break
  }
}

if (!data) {
  console.log(
    JSON.stringify(
      {
        found: false,
        entriesWithKey: entries.length,
        reason: 'Could not decode memorize-app-v1 value from Chrome LevelDB',
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const sampleNotes = {}
for (const deck of data.decks) {
  sampleNotes[deck.name] = data.notes
    .filter((n) => n.deckId === deck.id)
    .slice(0, 3)
    .map((n) => {
      if (n.type === 'cloze') return (n.fields?.text ?? '').slice(0, 100)
      const front = n.fields?.front ?? ''
      const back = n.fields?.back ?? ''
      return back ? `${front} → ${back}`.slice(0, 100) : front.slice(0, 100)
    })
}

console.log(
  JSON.stringify(
    {
      found: true,
      source: 'Chrome localStorage',
      origin,
      decks: data.decks.map((d) => d.name),
      noteCount: data.notes.length,
      cardCount: data.cards.length,
      deckNoteCounts: Object.fromEntries(
        data.decks.map((d) => [d.name, data.notes.filter((n) => n.deckId === d.id).length]),
      ),
      sampleNotes,
    },
    null,
    2,
  ),
)