/**
 * Puxa os membros do grupo aberto e salva todos em uma lista (coluna) do Kanban.
 */

import { useEffect, useState } from 'react'
import type { KanbanBoard, KanbanColumn } from '../src/types'
import { sendToBackground } from '../src/types'
import {
  DEFAULT_COLUMNS, getActiveBoardId, getBoards, getKanbanCards, getKanbanColumns,
  saveAllKanbanCards, saveBoards, saveKanbanColumns, setActiveBoardId,
} from '../src/storage'
import { mergeGroupMembers, type GroupMember } from '../src/groupImport'
import { explainWppError, wppCall } from '../src/wpp'
import { C } from '../src/theme'
import { overlayStyle, modalStyle, labelStyle, inputStyle, primaryBtn, errorStyle, okStyle } from '../src/ui'
import { Icon } from '../src/icons'

interface GroupData {
  groupName: string
  members: GroupMember[]
  hidden: number
}

const NEW_LIST = '__new__'
const NEW_BOARD = '__new_board__'

export function GroupImportModal({ onClose }: { onClose: () => void }) {
  const [group, setGroup] = useState<GroupData | null>(null)
  const [boards, setBoards] = useState<KanbanBoard[]>([])
  const [boardId, setBoardId] = useState('')
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [columnId, setColumnId] = useState(NEW_LIST)
  const [listName, setListName] = useState('')
  const [boardName, setBoardName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedBoardId, setSavedBoardId] = useState('')

  useEffect(() => {
    void (async () => {
      const r = await wppCall<GroupData>('getGroupParticipants', undefined, 30_000)
      if (!r.ok) return setError(explainWppError(r.error))
      setGroup(r.data)
      setListName(r.data.groupName)
    })()
    void (async () => {
      const [all, active] = await Promise.all([getBoards(), getActiveBoardId()])
      setBoards(all)
      setBoardId(all.some(b => b.id === active) ? active : all[0]?.id ?? active)
    })()
  }, [])

  useEffect(() => {
    if (!boardId) return
    setColumnId(NEW_LIST)
    if (boardId === NEW_BOARD) return setColumns(DEFAULT_COLUMNS)   // quadro novo nasce com as listas padrão
    let current = true
    void getKanbanColumns(boardId).then(cols => { if (current) setColumns([...cols].sort((a, b) => a.order - b.order)) })
    return () => { current = false }
  }, [boardId])

  /** Quadro escolhido; cria o novo na hora (ou reaproveita um com o mesmo nome). */
  async function resolveBoardId(): Promise<string> {
    if (boardId !== NEW_BOARD) return boardId
    const name = boardName.trim()
    const all = await getBoards()
    let board = all.find(b => b.name.trim().toLowerCase() === name.toLowerCase())
    if (!board) {
      board = { id: `board_${Date.now()}`, name, createdAt: Date.now() }
      await saveBoards([...all, board])
    }
    setBoards(await getBoards())
    return board.id
  }

  async function handleImport() {
    if (!group) return
    setError(null)
    const title = listName.trim()
    if (boardId === NEW_BOARD && !boardName.trim()) return setError('Dê um nome ao quadro novo.')
    if (columnId === NEW_LIST && !title) return setError('Dê um nome à lista nova.')
    setSaving(true)
    try {
      const now = Date.now()
      const targetBoard = await resolveBoardId()
      const current = await getKanbanColumns(targetBoard)
      let target = columnId === NEW_LIST
        ? current.find(c => c.title.trim().toLowerCase() === title.toLowerCase())
        : current.find(c => c.id === columnId)
      if (!target) {
        if (columnId !== NEW_LIST) throw new Error('A lista escolhida não existe mais.')
        target = {
          id: `col_${now}`, title, color: '#3F6B4B', createdAt: now,
          order: current.reduce((max, c) => Math.max(max, c.order), -1) + 1,
        }
        await saveKanbanColumns([...current, target], targetBoard)
      }
      const merged = mergeGroupMembers(group.members, await getKanbanCards(targetBoard), target.id, group.groupName.trim(), now)
      await saveAllKanbanCards(merged.cards, targetBoard)
      setSavedBoardId(targetBoard)
      setBoardId(targetBoard)
      setResult([
        `${merged.created} contato(s) adicionados na lista "${target.title}".`,
        merged.existing ? `${merged.existing} já estavam no quadro: continuam onde estavam e ganharam a tag do grupo.` : '',
        merged.invalid ? `${merged.invalid} com número inválido ficaram de fora.` : '',
      ].filter(Boolean).join(' '))
    } catch (e) {
      setError(`Não consegui salvar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function openKanban() {
    await setActiveBoardId(savedBoardId)
    await sendToBackground({ type: 'OPEN_KANBAN' })
    onClose()
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Puxar contatos do grupo" style={modalStyle(420)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', color: C.brand, fontWeight: 800, display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Icon name="download" size={20} /> Puxar contatos do grupo
          </h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!group && !error && <div style={{ fontSize: '13px', color: C.muted }}>Lendo os membros do grupo…</div>}

          {group && (
            <>
              <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                <strong>{group.groupName}</strong><br />
                {group.members.length} contato(s) com número.
                {group.hidden > 0 && <span style={{ color: C.warn }}> {group.hidden} com número oculto pelo WhatsApp não podem ser salvos.</span>}
              </div>
              <label style={labelStyle}>
                Quadro
                <select style={inputStyle} value={boardId} disabled={saving || !!result} onChange={e => setBoardId(e.target.value)}>
                  <option value={NEW_BOARD}>+ Criar quadro novo</option>
                  {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              {boardId === NEW_BOARD && !result && (
                <label style={labelStyle}>
                  Nome do quadro novo
                  <input style={inputStyle} value={boardName} disabled={saving} autoFocus placeholder="Ex.: Grupos do WhatsApp" onChange={e => setBoardName(e.target.value)} />
                </label>
              )}
              <label style={labelStyle}>
                Lista
                <select style={inputStyle} value={columnId} disabled={saving || !!result} onChange={e => setColumnId(e.target.value)}>
                  <option value={NEW_LIST}>+ Criar lista nova</option>
                  {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              {columnId === NEW_LIST && (
                <label style={labelStyle}>
                  Nome da lista nova
                  <input style={inputStyle} value={listName} disabled={saving || !!result} onChange={e => setListName(e.target.value)} />
                </label>
              )}
            </>
          )}

          {error && <div role="alert" style={errorStyle}>{error}</div>}
          {result && <div role="status" style={okStyle}>{result}</div>}

          {group && !result && (
            <button style={{ ...primaryBtn(saving), padding: '12px' }} onClick={() => void handleImport()} disabled={saving || group.members.length === 0}>
              <Icon name="check" size={16} /> {saving ? 'Salvando…' : `Adicionar ${group.members.length} contato(s)`}
            </button>
          )}
          {result && (
            <button style={{ ...primaryBtn(false), padding: '12px' }} onClick={() => void openKanban()}>
              <Icon name="kanban" size={16} /> Abrir Kanban
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
