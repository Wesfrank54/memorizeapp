import { useState } from 'react'
import type { AppState, Note } from '../../core/types.ts'
import { computeStats } from '../../core/stats.ts'
import { deleteDeck, resetAll, updateDeck, updateNote, deleteNote } from '../../core/store.ts'

export function DeckList({ state }: { state: AppState }) {
  const stats = computeStats(state, new Date())
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ fields: Record<string, string>; tags: string[] }>({ fields: {}, tags: [] })

  const selectedDeck = selectedDeckId ? state.decks.find((d) => d.id === selectedDeckId) : null
  const deckNotes = selectedDeckId
    ? state.notes.filter((n) => n.deckId === selectedDeckId)
    : []

  function startEdit(note: Note) {
    setEditingNoteId(note.id)
    setEditDraft({
      fields: { ...note.fields },
      tags: [...(note.tags || [])],
    })
  }

  function saveEdit() {
    if (!editingNoteId) return
    updateNote(editingNoteId, {
      fields: editDraft.fields,
      tags: editDraft.tags,
    })
    setEditingNoteId(null)
  }

  function cancelEdit() {
    setEditingNoteId(null)
  }

  function updateDraftField(key: string, value: string) {
    setEditDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }))
  }

  function updateDraftTags(value: string) {
    const tags = value.split(/[\s,;]+/).filter(Boolean)
    setEditDraft((d) => ({ ...d, tags }))
  }

  return (
    <div className="panel">
      {state.decks.length === 0 ? (
        <p className="muted center">No decks yet. Add a card or import a CSV to get started.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Deck</th>
              <th>Cards</th>
              <th>Due</th>
              <th>New</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stats.perDeck.map((d) => (
              <tr key={d.deckId}>
                <td>
                  <span
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                    title="Click to rename or view notes"
                    onClick={() => {
                      const newName = prompt('Rename deck (or cancel to just view notes)', d.name)
                      if (newName && newName.trim() && newName !== d.name) {
                        updateDeck(d.deckId, { name: newName.trim() })
                      }
                      setSelectedDeckId(d.deckId)
                    }}
                  >
                    {d.name}
                  </span>
                  <button
                    className="link"
                    style={{ marginLeft: 8, fontSize: '11px' }}
                    onClick={() => setSelectedDeckId(selectedDeckId === d.deckId ? null : d.deckId)}
                  >
                    {selectedDeckId === d.deckId ? 'hide notes' : 'notes'}
                  </button>
                </td>
                <td>{d.total}</td>
                <td>{d.due}</td>
                <td>{d.new}</td>
                <td>
                  <button
                    className="link danger"
                    onClick={() => {
                      if (confirm(`Delete "${d.name}" and all its cards? This cannot be undone.`)) {
                        deleteDeck(d.deckId)
                        if (selectedDeckId === d.deckId) setSelectedDeckId(null)
                      }
                    }}
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedDeck && deckNotes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="muted small" style={{ marginBottom: 8 }}>
            Notes in <strong>{selectedDeck.name}</strong> (click name above to edit deck)
          </div>
          <div className="panel" style={{ padding: 12 }}>
            {deckNotes.map((note) => {
              const isEditing = editingNoteId === note.id
              return (
                <div key={note.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                  <div className="row between" style={{ marginBottom: 4 }}>
                    <span className="muted small">
                      {note.type} · {note.tags?.length ? note.tags.join(', ') : 'no tags'}
                    </span>
                    {!isEditing && (
                      <span>
                        <button className="link" onClick={() => startEdit(note)}>edit</button>
                        <button
                          className="link danger"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            if (confirm('Delete this note?')) deleteNote(note.id)
                          }}
                        >
                          delete
                        </button>
                      </span>
                    )}
                  </div>

                  {!isEditing ? (
                    <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>
                      {Object.entries(note.fields).map(([k, v]) => (
                        <div key={k}>
                          <strong>{k}:</strong> {v}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      {Object.keys(editDraft.fields).map((key) => (
                        <div key={key} className="field" style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 12 }}>{key}</label>
                          <textarea
                            value={editDraft.fields[key] || ''}
                            onChange={(e) => updateDraftField(key, e.target.value)}
                            rows={2}
                            style={{ width: '100%' }}
                          />
                        </div>
                      ))}
                      <div className="field">
                        <label style={{ fontSize: 12 }}>Tags (comma/space separated)</label>
                        <input
                          value={editDraft.tags.join(' ')}
                          onChange={(e) => updateDraftTags(e.target.value)}
                        />
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <button className="primary" onClick={saveEdit} style={{ marginRight: 8 }}>
                          Save
                        </button>
                        <button className="link" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {selectedDeck && deckNotes.length === 0 && (
        <p className="muted small" style={{ marginTop: 12 }}>No notes in this deck yet.</p>
      )}

      <div className="row between footer-row">
        <span className="muted small">{stats.totalCards} cards across {state.decks.length} decks</span>
        <button
          className="link danger"
          onClick={() => {
            if (confirm('Reset everything and restore the sample decks?')) resetAll()
          }}
        >
          reset all data
        </button>
      </div>
    </div>
  )
}

