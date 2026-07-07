import { useState } from 'react'
import type { AppState } from '../../core/types.ts'
import { addBasicNote, addClozeNote, addDeck } from '../../core/store.ts'
import { clozeIndices } from '../../core/cloze.ts'

export function AddCard({ state }: { state: AppState }) {
  const [deckId, setDeckId] = useState(state.decks[0]?.id ?? '')
  const [newDeck, setNewDeck] = useState('')
  const [type, setType] = useState<'basic' | 'cloze'>('basic')
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [clozeText, setClozeText] = useState('')
  const [tags, setTags] = useState('')
  const [flash, setFlash] = useState('')

  const clozeCount = clozeIndices(clozeText).length

  function flashFor(msg: string) {
    setFlash(msg)
    window.setTimeout(() => setFlash(''), 2200)
  }

  function submit() {
    const tagList = tags.split(/[\s,;]+/).filter(Boolean)
    const targetDeck = newDeck.trim() ? addDeck(newDeck.trim()).id : deckId
    if (!targetDeck) {
      flashFor('Pick or create a deck first.')
      return
    }
    if (type === 'basic') {
      if (!front.trim() || !back.trim()) return
      addBasicNote(targetDeck, front, back, tagList)
      setFront('')
      setBack('')
      flashFor('Card added ✓')
    } else {
      if (clozeCount === 0) return
      addClozeNote(targetDeck, clozeText, tagList)
      setClozeText('')
      flashFor(`Added ${clozeCount} cloze card${clozeCount > 1 ? 's' : ''} ✓`)
    }
    if (newDeck.trim()) setDeckId(state.decks[0]?.id ?? deckId)
    setNewDeck('')
  }

  return (
    <div className="panel form">
      <div className="field">
        <label>Deck</label>
        <div className="row">
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={!!newDeck.trim()}>
            {state.decks.length === 0 && <option value="">(no decks yet)</option>}
            {state.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input placeholder="or new deck name…" value={newDeck} onChange={(e) => setNewDeck(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Type</label>
        <div className="row toggle">
          <button className={type === 'basic' ? 'active' : ''} onClick={() => setType('basic')}>
            Basic
          </button>
          <button className={type === 'cloze' ? 'active' : ''} onClick={() => setType('cloze')}>
            Cloze
          </button>
        </div>
      </div>

      {type === 'basic' ? (
        <>
          <div className="field">
            <label>Front (prompt)</label>
            <textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} placeholder="Capital of France?" />
          </div>
          <div className="field">
            <label>Back (answer)</label>
            <textarea value={back} onChange={(e) => setBack(e.target.value)} rows={2} placeholder="Paris" />
          </div>
        </>
      ) : (
        <div className="field">
          <label>
            Cloze text <span className="muted">— use {'{{c1::answer}}'}</span>
          </label>
          <textarea
            value={clozeText}
            onChange={(e) => setClozeText(e.target.value)}
            rows={3}
            placeholder="The powerhouse of the cell is the {{c1::mitochondria}}."
          />
          <div className="muted small">
            {clozeCount > 0 ? `${clozeCount} card${clozeCount > 1 ? 's' : ''} will be created` : 'no clozes detected yet'}
          </div>
        </div>
      )}

      <div className="field">
        <label>Tags <span className="muted">— optional, space-separated</span></label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="geography capitals" />
      </div>

      <div className="row between">
        <button className="primary" onClick={submit}>
          Add card
        </button>
        {flash && <span className="flash">{flash}</span>}
      </div>
    </div>
  )
}
