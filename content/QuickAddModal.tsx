/**
 * Salva a conversa aberta como card no Kanban.
 */

import { useEffect, useState } from 'react'
import type { KanbanCard, KanbanColumn } from '../src/types'
import { getKanbanCards, getKanbanColumns, saveKanbanCard } from '../src/storage'
import { formatPhone, normalizePhone } from '../src/phone'
import { C } from '../src/theme'
import { overlayStyle, modalStyle, labelStyle, inputStyle, primaryBtn, errorStyle, okStyle } from '../src/ui'
import { Icon } from '../src/icons'
import type { CurrentContact } from './whatsapp-bridge'
import { usePhoneDetection } from './usePhoneDetection'
import { WaCheck } from './WaCheck'

export function QuickAddModal({ contact, onClose }: { contact: CurrentContact | null; onClose: () => void }) {
  const [name, setName] = useState(contact?.name ?? '')
  const [phoneRaw, setPhoneRaw] = useState(contact?.phone ? formatPhone(contact.phone) : '')
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [columnId, setColumnId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void getKanbanColumns().then(cols => {
      const sorted = [...cols].sort((a, b) => a.order - b.order)
      setColumns(sorted)
      setColumnId(sorted[0]?.id ?? '')
    })
  }, [])

  const phone = normalizePhone(phoneRaw)
  const detection = usePhoneDetection(contact, p => setPhoneRaw(cur => (cur.trim() ? cur : formatPhone(p))))

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('Informe o nome.')
    if (!phone) return setError('Telefone inválido. Use DDD + número.')
    const cards = await getKanbanCards()
    if (cards.some(c => c.phone === phone)) return setError('Este telefone já está no Kanban.')
    const now = Date.now()
    const inColumn = cards.filter(c => c.columnId === columnId)
    const card: KanbanCard = {
      id: `card_${now}_${Math.random().toString(36).slice(2)}`,
      contactName: name.trim(),
      phone,
      columnId,
      columnChangedAt: now,
      columnHistory: [{ columnId, at: now }],
      tags: [],
      notes: '',
      lastMessage: '',
      lastMessageAt: now,
      order: inColumn.length ? Math.max(...inColumn.map(c => c.order)) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    }
    await saveKanbanCard(card)
    setSaved(true)
    setTimeout(onClose, 1100)
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Salvar no Kanban" style={modalStyle(380)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', color: C.brand, fontWeight: 800, display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Icon name="userPlus" size={20} /> Salvar no Kanban
          </h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={labelStyle}>
            Nome
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label style={labelStyle}>
            Telefone
            <input style={inputStyle} value={phoneRaw} onChange={e => setPhoneRaw(e.target.value)} placeholder="(31) 99999-9999" />
            <span style={{ fontSize: '11px', fontWeight: 600, color: phone ? C.ok : detection.failed ? C.warn : C.muted }}>
              {detection.detecting
                ? 'Detectando o telefone no WhatsApp…'
                : phone
                  ? formatPhone(phone)
                  : <>
                      {detection.failed ? 'Não achei o telefone: digite com DDD. ' : 'DDD + número. '}
                      {contact && <button type="button" onClick={detection.run} style={{ background: 'none', border: 'none', padding: 0, color: C.brand, fontWeight: 800, textDecoration: 'underline', fontSize: '11px' }}>Detectar do WhatsApp</button>}
                    </>}
            </span>
            <WaCheck phone={phone} />
          </label>
          <label style={labelStyle}>
            Etapa
            <select style={inputStyle} value={columnId} onChange={e => setColumnId(e.target.value)}>
              {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          {error && <div role="alert" style={errorStyle}>{error}</div>}
          {saved && <div style={okStyle}>Contato salvo no Kanban.</div>}
          <button style={{ ...primaryBtn(saved), padding: '12px' }} onClick={handleSave} disabled={saved}>
            {saved ? 'Salvo' : <><Icon name="check" size={16} /> Salvar contato</>}
          </button>
        </div>
      </div>
    </div>
  )
}
