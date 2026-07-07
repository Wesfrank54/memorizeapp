import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { importCsv } from '../../core/store.ts'

const SAMPLE = `type,deck,front,back,text,tags
basic,Geography,"Capital of France?",Paris,,europe
basic,Astronomy,"Largest planet?",Jupiter,,planets
cloze,Biology,,,"The powerhouse of the cell is the {{c1::mitochondria}}.",cells`

export function ImportCsv() {
  const [text, setText] = useState('')
  const [result, setResult] = useState('')

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

  return (
    <div className="panel form">
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
