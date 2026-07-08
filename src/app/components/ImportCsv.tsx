import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { ensureGalleyDeck, GALLEY_DECK_NAME } from '../../core/galley-deck.ts'
import { importCsv } from '../../core/store.ts'

const SAMPLE = `type,deck,front,back,text,tags
basic,Geography,"Capital of France?",Paris,,europe
basic,Astronomy,"Largest planet?",Jupiter,,planets
cloze,Biology,,,"The powerhouse of the cell is the {{c1::mitochondria}}.",cells`

export function ImportCsv() {
  const [text, setText] = useState('')
  const [result, setResult] = useState('')
  const [bundledLoading, setBundledLoading] = useState(false)

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) file.text().then(setText)
  }

  function run() {
    const { decksCreated, cardsAdded } = importCsv(text)
    setResult(
      cardsAdded > 0
        ? `Imported ${cardsAdded} cards${decksCreated ? `, created ${decksCreated} new deck${decksCreated > 1 ? 's' : ''}` : ''}.`
        : 'Nothing imported — check the format (needs front,back[,deck]).',
    )
  }

  async function loadGalleyDeck(force = false) {
    setBundledLoading(true)
    try {
      const r = await ensureGalleyDeck({ force })
      if (r.reloaded || r.decksCreated > 0) {
        setResult(
          `${force || r.reloaded ? 'Reloaded' : 'Loaded'} "${GALLEY_DECK_NAME}" — ${r.cardsAdded} cards (Learn tab → pick this deck).`,
        )
      } else {
        setResult(`"${GALLEY_DECK_NAME}" already loaded — open Learn and select it, or reload to replace.`)
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Failed to load galley deck.')
    } finally {
      setBundledLoading(false)
    }
  }

  return (
    <div className="panel form">
      <div className="field bundled-decks">
        <label>ODS bundled decks</label>
        <p className="muted small">
          Galley Procedures is built for Learn mode: short command/response cards grouped by phase tags
          (entering, lines, seating, exit).
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={bundledLoading}
            onClick={() => void loadGalleyDeck(false)}
          >
            {bundledLoading ? 'Loading…' : `Load ${GALLEY_DECK_NAME}`}
          </button>
          <button
            type="button"
            className="link"
            disabled={bundledLoading}
            onClick={() => void loadGalleyDeck(true)}
          >
            Reload galley deck
          </button>
        </div>
      </div>
      <div className="field">
        <label>Paste CSV <span className="muted">— columns: type (basic/cloze), deck, front, back, text (cloze), tags. Also accepts plain front,back,deck.</span></label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={SAMPLE} spellCheck={false} />
      </div>
      <div className="row between">
        <div className="row">
          <button className="primary" onClick={run} disabled={!text.trim()}>
            Import
          </button>
          <label className="link file-label">
            load .csv file
            <input type="file" accept=".csv,text/csv" onChange={onFile} hidden />
          </label>
          <button className="link" onClick={() => setText(SAMPLE)}>
            use sample
          </button>
        </div>
        {result && <span className="flash">{result}</span>}
      </div>
    </div>
  )
}
