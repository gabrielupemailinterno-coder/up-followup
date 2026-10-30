import { useState } from 'react'
import type { KanbanCard, KanbanColumn } from '../src/types'
import { C, R } from '../src/theme'
import { dangerBtn, errorStyle, ghostBtn, inputStyle, labelStyle, modalStyle, overlayStyle, primaryBtn } from '../src/ui'
import { Icon } from '../src/icons'

const SWATCHES = ['#7B896F', '#56788A', '#4E8A86', '#8C6A8F', '#B08A3E', '#3F6B4B', '#A5432F', '#3A4A3F']

export interface ColumnEdit {
  title: string
  description: string
  color: string
}

/**
 * Editor de coluna: nome, descrição da etapa, cor, posição e exclusão.
 * Sem `column` = criando uma coluna nova.
 */
export function ColumnEditor({
  column, columns, cards, onSave, onMove, onDelete, onClose,
}: {
  column?: KanbanColumn
  columns: KanbanColumn[]
  cards: KanbanCard[]
  onSave: (edit: ColumnEdit) => void
  onMove?: (dir: -1 | 1) => void
  onDelete?: (moveCardsTo?: string) => void
  onClose: () => void
}) {
  const isNew = !column
  const [title, setTitle] = useState(column?.title ?? '')
  const [description, setDescription] = useState(column?.description ?? '')
  const [color, setColor] = useState(column?.color ?? SWATCHES[0])
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const idx = column ? columns.findIndex(c => c.id === column.id) : -1
  const inColumn = column ? cards.filter(c => c.columnId === column.id).length : 0
  const others = columns.filter(c => c.id !== column?.id)
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '')

  function save() {
    setError(null)
    if (!title.trim()) return setError('Dê um nome à coluna.')
    if (columns.some(c => c.id !== column?.id && c.title.trim().toLowerCase() === title.trim().toLowerCase())) {
      return setError('Já existe uma coluna com este nome.')
    }
    onSave({ title: title.trim(), description: description.trim(), color })
  }

  const moveBtn = (enabled: boolean): React.CSSProperties => ({ ...ghostBtn, opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'not-allowed' })

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={isNew ? 'Nova coluna' : 'Editar coluna'} style={modalStyle(460)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: C.brand, display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Icon name={isNew ? 'plus' : 'pencil'} size={19} /> {isNew ? 'Nova coluna' : 'Editar coluna'}
          </h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={labelStyle}>
            Nome da coluna
            <input
              style={inputStyle}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="Ex.: Documentação"
              autoFocus
            />
          </label>

          <label style={labelStyle}>
            O que significa esta etapa? (opcional)
            <textarea
              style={{ ...inputStyle, minHeight: '64px', resize: 'vertical' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex.: Respondeu. Entendendo interesse, prazo e perfil."
            />
            <span style={{ fontSize: '11px', fontWeight: 500, color: C.muted }}>Aparece sob o nome da coluna e ajuda o time a classificar igual.</span>
          </label>

          <div>
            <div style={{ ...labelStyle, marginBottom: '8px' }}>Cor</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {SWATCHES.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`Cor ${c}`}
                  aria-pressed={color === c}
                  style={{ width: '28px', height: '28px', borderRadius: '50%', background: c, border: color === c ? `3px solid ${C.ink}` : '3px solid transparent', outline: color === c ? `2px solid ${C.surface}` : 'none', outlineOffset: '-5px' }}
                />
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: C.muted, marginLeft: '6px' }}>
                Outra
                <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Escolher outra cor" style={{ width: '28px', height: '28px' }} />
              </label>
            </div>
          </div>

          {!isNew && onMove && (
            <div>
              <div style={{ ...labelStyle, marginBottom: '8px' }}>Posição no funil</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={moveBtn(idx > 0)} disabled={idx <= 0} onClick={() => onMove(-1)}><Icon name="chevronLeft" size={15} /> Mover para a esquerda</button>
                <button style={moveBtn(idx < columns.length - 1)} disabled={idx >= columns.length - 1} onClick={() => onMove(1)}>Mover para a direita <Icon name="chevronRight" size={15} /></button>
              </div>
            </div>
          )}

          {error && <div role="alert" style={errorStyle}>{error}</div>}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={{ ...ghostBtn, flex: 1 }} onClick={onClose}>Cancelar</button>
            <button style={{ ...primaryBtn(), flex: 1 }} onClick={save}>{isNew ? 'Criar coluna' : 'Salvar alterações'}</button>
          </div>

          {!isNew && onDelete && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: '14px' }}>
              {!confirmingDelete ? (
                <button style={dangerBtn} onClick={() => (columns.length <= 1 ? setError('Mantenha pelo menos uma coluna.') : setConfirmingDelete(true))}>
                  <Icon name="trash" size={15} /> Excluir coluna
                </button>
              ) : (
                <div style={{ background: C.dangerSoft, border: '1px solid #EBC4BA', borderRadius: R.md, padding: '12px 14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: C.danger, marginBottom: '8px' }}>
                    {inColumn > 0 ? `Esta coluna tem ${inColumn} contato(s).` : 'Excluir esta coluna?'}
                  </div>
                  {inColumn > 0 && (
                    <label style={{ ...labelStyle, marginBottom: '10px' }}>
                      Mover os contatos para
                      <select style={inputStyle} value={moveTo} onChange={e => setMoveTo(e.target.value)}>
                        {others.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                    </label>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={ghostBtn} onClick={() => setConfirmingDelete(false)}>Voltar</button>
                    <button style={{ ...dangerBtn, fontWeight: 800 }} onClick={() => onDelete(inColumn > 0 ? moveTo : undefined)}>
                      {inColumn > 0 ? 'Mover e excluir' : 'Excluir'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
