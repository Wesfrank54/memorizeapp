// Minimal RFC-4180-ish CSV parser + mapper to importable card rows.

/** Parse CSV text into a grid of rows, honoring quotes, escaped quotes, and embedded newlines/commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/\r\n?/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export interface CsvCard {
  front: string
  back: string
  deck: string
  tags: string[]
}

/**
 * Map CSV rows to card rows. Accepts an optional header line containing "front"
 * and "back"; otherwise treats columns positionally as front,back,deck,tags.
 */
export function csvToCards(text: string, defaultDeck = 'Imported'): CsvCard[] {
  const rows = parseCsv(text)
  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const hasHeader = header.includes('front') && header.includes('back')
  const col = (name: string) => header.indexOf(name)
  const idx = hasHeader
    ? { front: col('front'), back: col('back'), deck: col('deck'), tags: col('tags') }
    : { front: 0, back: 1, deck: 2, tags: 3 }

  const body = hasHeader ? rows.slice(1) : rows
  const cards: CsvCard[] = []
  for (const r of body) {
    const front = (r[idx.front] ?? '').trim()
    const back = (r[idx.back] ?? '').trim()
    if (!front || !back) continue
    const deck = (idx.deck >= 0 ? r[idx.deck] : '')?.trim() || defaultDeck
    const tagCell = idx.tags >= 0 ? (r[idx.tags] ?? '').trim() : ''
    const tags = tagCell ? tagCell.split(/[\s;]+/).filter(Boolean) : []
    cards.push({ front, back, deck, tags })
  }
  return cards
}

export interface CsvNote {
  type: 'basic' | 'cloze'
  deck: string
  front: string
  back: string
  /** cloze text with {{c1::...}} deletions (cloze notes only) */
  text: string
  /** Optional path or URL for question-side image (basic notes). */
  frontImage: string
  backImage: string
  tags: string[]
}

/**
 * Richer importer that supports both basic and cloze notes. Recognizes a header
 * with any of: type, front, back, text, deck, tags. A row with type=cloze uses
 * the `text` column (with {{c1::...}} deletions); otherwise it's a basic
 * front/back note. Falls back to positional front,back,deck,tags with no header.
 */
export function csvToNotes(text: string, defaultDeck = 'Imported'): CsvNote[] {
  const rows = parseCsv(text)
  if (rows.length === 0) return []

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const hasHeader = header.includes('front') || header.includes('text') || header.includes('type')
  const col = (name: string) => header.indexOf(name)
  const idx = hasHeader
    ? {
        type: col('type'),
        deck: col('deck'),
        front: col('front'),
        back: col('back'),
        text: col('text'),
        frontImage: col('frontimage') >= 0 ? col('frontimage') : col('image'),
        backImage: col('backimage'),
        tags: col('tags'),
      }
    : { type: -1, deck: 2, front: 0, back: 1, text: -1, frontImage: -1, backImage: -1, tags: 3 }

  const body = hasHeader ? rows.slice(1) : rows
  const notes: CsvNote[] = []
  for (const r of body) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '') : '').trim()
    const deck = get(idx.deck) || defaultDeck
    const tagCell = get(idx.tags)
    const tags = tagCell ? tagCell.split(/[\s;]+/).filter(Boolean) : []
    const type = get(idx.type).toLowerCase() === 'cloze' ? 'cloze' : 'basic'

    if (type === 'cloze') {
      const clozeText = get(idx.text)
      if (!clozeText) continue
      notes.push({ type: 'cloze', deck, front: '', back: '', text: clozeText, frontImage: '', backImage: '', tags })
    } else {
      const front = get(idx.front)
      const back = get(idx.back)
      const frontImage = get(idx.frontImage)
      const backImage = get(idx.backImage)
      if ((!front && !frontImage) || !back) continue
      notes.push({ type: 'basic', deck, front, back, text: '', frontImage, backImage, tags })
    }
  }
  return notes
}
