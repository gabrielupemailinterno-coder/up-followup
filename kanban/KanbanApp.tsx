import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanCard, KanbanColumn, KanbanBoard } from '../src/types'
import { sendToBackground } from '../src/types'
import {
  ensureSchema,
  getKanbanCards,
  getKanbanColumns,
  saveAllKanbanCards,
  saveKanbanColumns,
  applyColumnChange,
  DEFAULT_COLUMNS,
  getBoards,
  saveBoards,
  getActiveBoardId,
  setActiveBoardId,
  deleteBoard,
  DEFAULT_BOARD,
  DEFAULT_BOARD_ID,
} from '../src/storage'
import { formatPhone, normalizePhone } from '../src/phone'
import { C, FONT, R, SHADOW } from '../src/theme'
import {
  overlayStyle, labelStyle, inputStyle, primaryBtn, ghostBtn, dangerBtn, errorStyle, modalStyle,
} from '../src/ui'
import { Icon, type IconName } from '../src/icons'
import { useFeedback } from '../src/feedback'
import { crmStageForMove, enqueueCrmStage } from '../src/crmStageSync'
import { SettingsModal } from './SettingsModal'
import { ColumnEditor, type ColumnEdit } from './ColumnEditor'
import { CampaignsPanel } from './CampaignsPanel'
import { MetricsPanel } from './MetricsPanel'
import { parseXlsx, mergeImportedLeads } from '../src/xlsxImport'

type View = 'board' | 'campaigns' | 'metrics'

const DAY = 86_400_000
const logo = (f: string) => chrome.runtime.getURL(`brand/${f}`)

function initialView(): View {
  const h = window.location.hash
  return h === '#campanhas' ? 'campaigns' : h === '#metricas' ? 'metrics' : 'board'
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function KanbanApp() {
  const { toast, confirm } = useFeedback()
  const [boards, setBoards] = useState<KanbanBoard[]>([DEFAULT_BOARD])
  const [activeBoardId, setActiveBoardIdState] = useState<string>(DEFAULT_BOARD_ID)
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [cards, setCards] = useState<KanbanCard[]>([])
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [columnFilter, setColumnFilter] = useState('')
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null)
  const [newCardColumn, setNewCardColumn] = useState<string | null>(null)
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | 'new' | null>(null)
  const [showSettings, setShowSettings] = useState(window.location.hash === '#config')
  const [showBoardEditor, setShowBoardEditor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>(initialView())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(async (boardId?: string) => {
    await ensureSchema()
    const [bds, savedBoardId, cols, cds] = await Promise.all([
      getBoards(),
      getActiveBoardId(),
      getKanbanColumns(boardId),
      getKanbanCards(boardId),
    ])
    const bid = boardId ?? savedBoardId
    setBoards(bds)
    setActiveBoardIdState(bid)
    setColumns([...cols].sort((a, b) => a.order - b.order))
    setCards([...cds].sort((a, b) => a.order - b.order))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function switchBoard(boardId: string) {
    setLoading(true)
    setSearch(''); setTagFilter(''); setColumnFilter('')
    await setActiveBoardId(boardId)
    await load(boardId)
  }

  async function createBoard(name: string) {
    const id = `board_${Date.now()}`
    const board: KanbanBoard = { id, name, createdAt: Date.now() }
    const next = [...boards, board]
    await saveBoards(next)
    setBoards(next)
    await switchBoard(id)
    toast(`Quadro "${name}" criado.`, 'ok')
  }

  async function renameBoard(boardId: string, name: string) {
    const next = boards.map(b => b.id === boardId ? { ...b, name } : b)
    await saveBoards(next)
    setBoards(next)
  }

  async function removeBoardConfirm(boardId: string) {
    if (boardId === DEFAULT_BOARD_ID) { toast('O quadro principal não pode ser excluído.', 'err'); return }
    const board = boards.find(b => b.id === boardId)
    const ok = await confirm({ title: 'Excluir quadro', message: `Excluir o quadro "${board?.name ?? boardId}" e todos os seus leads? Essa ação não pode ser desfeita.`, confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await deleteBoard(boardId)
    const next = boards.filter(b => b.id !== boardId)
    await saveBoards(next)
    setBoards(next)
    const nextId = next[0]?.id ?? DEFAULT_BOARD_ID
    await switchBoard(nextId)
    toast('Quadro excluído.')
  }

  const allTags = useMemo(() => [...new Set(cards.flatMap(c => c.tags))].sort(), [cards])

  // ─── Drag & Drop ─────────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    setActiveCard(cards.find(c => c.id === event.active.id) ?? null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const dragged = cards.find(c => c.id === active.id)
    if (!dragged) return

    let updated: KanbanCard[]
    const overColumn = columns.find(col => col.id === over.id)
    if (overColumn) {
      // Soltou sobre a coluna (inclusive vazia): vai para o fim dela
      const maxOrder = cards.reduce((m, c) => Math.max(m, c.order), 0)
      updated = cards.map(c =>
        c.id === dragged.id ? { ...applyColumnChange(c, overColumn.id), order: maxOrder + 1 } : c
      )
    } else {
      const overCard = cards.find(c => c.id === over.id)
      if (!overCard) return
      updated = cards.map(c =>
        c.id === dragged.id ? applyColumnChange(c, overCard.columnId) : c
      )
      const oldIdx = updated.findIndex(c => c.id === active.id)
      const newIdx = updated.findIndex(c => c.id === over.id)
      updated = arrayMove(updated, oldIdx, newIdx)
    }
    updated = updated.map((c, i) => ({ ...c, order: i }))
    setCards(updated)
    await saveAllKanbanCards(updated, activeBoardId)

    // Card ligado ao CRM mudou de coluna: oferece mover também a etapa no CRM.
    const moved = updated.find(c => c.id === dragged.id)
    if (moved && moved.columnId !== dragged.columnId) {
      const target = await crmStageForMove(dragged, moved.columnId)
      if (target && await confirm({ title: 'Mover também no CRM?', message: `Mudar a etapa de "${moved.contactName}" no CRM Incbook para "${target}"? A extensão abre o lead, confere o telefone e muda a etapa (em modo teste só confere).`, confirmLabel: 'Mover no CRM' })) {
        const r = await enqueueCrmStage(moved, target)
        if (r.error) toast(r.error, 'err')
        else {
          const next = updated.map(c => (c.id === moved.id ? r.card : c))
          setCards(next)
          await saveAllKanbanCards(next, activeBoardId)
          toast('Na fila do CRM: a etapa será alterada em instantes.')
        }
      }
    }
  }

  async function syncCrm() {
    const r = await sendToBackground({ type: 'CRM_SYNC' })
    toast(r.ok ? 'Sincronizando com o CRM: uma janela do CRM abre e lê a tela Leads. O resultado aparece na aba CRM do ícone UP.' : r.message, r.ok ? 'ok' : 'err')
  }

  const xlsxInputRef = React.useRef<HTMLInputElement>(null)

  async function handleXlsxUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!e.target) return
    e.target.value = ''   // permite re-selecionar o mesmo arquivo
    if (!file) return
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast('Selecione um arquivo .xlsx exportado do CRM.', 'err'); return
    }
    try {
      const buf = await file.arrayBuffer()
      const { leads, skipped, total } = parseXlsx(buf)
      if (leads.length === 0) { toast('Nenhum lead encontrado na planilha.', 'err'); return }

      const now = Date.now()
      const newId = () => `imp_${now}_${Math.random().toString(36).slice(2, 8)}`
      const merged = mergeImportedLeads(leads, columns, cards, newId, now)

      await Promise.all([
        saveKanbanColumns(merged.columns, activeBoardId),
        saveAllKanbanCards(merged.cards, activeBoardId),
      ])
      setColumns(merged.columns)
      setCards(merged.cards)

      const msg = `Importados: ${merged.created} novos · ${merged.updated} atualizados · ${skipped} ignorados (de ${total} linhas).`
      toast(msg, 'ok')
    } catch (err) {
      toast(`Erro ao ler a planilha: ${err instanceof Error ? err.message : String(err)}`, 'err')
    }
  }

  // ─── Colunas ─────────────────────────────────────────────────────────────────
  async function persistColumns(next: KanbanColumn[]) {
    const ordered = next.map((c, i) => ({ ...c, order: i }))
    setColumns(ordered)
    await saveKanbanColumns(ordered, activeBoardId)
  }

  async function saveColumn(edit: ColumnEdit) {
    if (editingColumn === 'new') {
      await persistColumns([
        ...columns,
        { id: `col_${Date.now()}`, ...edit, order: columns.length, createdAt: Date.now() },
      ])
      toast('Coluna criada.')
    } else if (editingColumn) {
      const id = editingColumn.id
      await persistColumns(columns.map(c => (c.id === id ? { ...c, ...edit } : c)))
      toast('Coluna atualizada.')
    }
    setEditingColumn(null)
  }

  async function moveColumn(col: KanbanColumn, dir: -1 | 1) {
    const idx = columns.findIndex(c => c.id === col.id)
    const target = idx + dir
    if (target < 0 || target >= columns.length) return
    await persistColumns(arrayMove(columns, idx, target))
  }

  async function deleteColumn(col: KanbanColumn, moveCardsTo?: string) {
    if (columns.length <= 1) {
      toast('Mantenha pelo menos uma coluna.', 'err')
      return
    }
    const inColumn = cards.filter(c => c.columnId === col.id)
    if (inColumn.length > 0) {
      if (!moveCardsTo) {
        toast(`"${col.title}" ainda tem ${inColumn.length} contato(s). Escolha para onde movê-los.`, 'err')
        return
      }
      const nextCards = cards.map(c => (c.columnId === col.id ? applyColumnChange(c, moveCardsTo) : c))
      setCards(nextCards)
      await saveAllKanbanCards(nextCards, activeBoardId)
    }
    await persistColumns(columns.filter(c => c.id !== col.id))
    setEditingColumn(null)
    toast('Coluna excluída.')
  }

  async function resetColumns() {
    const ok = await confirm({
      title: 'Restaurar colunas padrão',
      message: 'Volta ao funil imobiliário padrão. Cards em colunas que deixarem de existir vão para a primeira coluna.',
      confirmLabel: 'Restaurar',
    })
    if (!ok) return
    const ids = new Set(DEFAULT_COLUMNS.map(c => c.id))
    const next = cards.map(c => (ids.has(c.columnId) ? c : applyColumnChange(c, DEFAULT_COLUMNS[0].id)))
    setCards(next)
    await saveAllKanbanCards(next, activeBoardId)
    await persistColumns(DEFAULT_COLUMNS.map(c => ({ ...c, createdAt: Date.now() })))
    toast('Colunas restauradas.')
  }

  // ─── Cards ───────────────────────────────────────────────────────────────────
  async function handleSaveCard(card: KanbanCard) {
    const exists = cards.some(c => c.id === card.id)
    const next = exists ? cards.map(c => (c.id === card.id ? card : c)) : [...cards, card]
    setCards(next)
    await saveAllKanbanCards(next, activeBoardId)
    setEditingCard(null)
    setNewCardColumn(null)
    toast(exists ? 'Contato atualizado.' : 'Contato adicionado.')
  }

  async function handleDeleteCard(id: string) {
    const next = cards.filter(c => c.id !== id)
    setCards(next)
    await saveAllKanbanCards(next, activeBoardId)
    setEditingCard(null)
    toast('Contato excluído.')
  }

  const cardsOf = useCallback(
    (colId: string) => {
      const q = search.trim().toLowerCase()
      const qDigits = q.replace(/\D/g, '')
      return cards
        .filter(c => c.columnId === colId)
        .filter(c => !tagFilter || c.tags.includes(tagFilter))
        .filter(c =>
          !q ||
          c.contactName.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          c.tags.some(t => t.toLowerCase().includes(q)) ||
          (qDigits.length >= 3 && c.phone.includes(qDigits))
        )
        .sort((a, b) => a.order - b.order)
    },
    [cards, search, tagFilter]
  )

  if (loading) {
    return <div style={{ padding: 40, fontFamily: FONT, color: C.muted }}>Carregando…</div>
  }

  const visibleColumns = columnFilter ? columns.filter(c => c.id === columnFilter) : columns
  const filtering = Boolean(search || tagFilter || columnFilter)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: C.bg, fontFamily: FONT, color: C.ink }}>
      {/* Barra superior */}
      <header style={{ background: `linear-gradient(120deg, ${C.inkSoft} 0%, ${C.brand} 60%, #56654F 100%)`, padding: '12px 22px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', color: C.onBrand }}>
        <img src={logo('logo-up-offwhite.png')} alt="UP" style={{ height: '24px' }} />
        <span style={{ width: '1px', height: '24px', background: 'rgba(247,244,237,0.3)' }} />

        {/* Seletor de quadros */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '260px', overflow: 'hidden' }}>
          <select
            aria-label="Quadro ativo"
            value={activeBoardId}
            onChange={e => void switchBoard(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: C.onBrand, borderRadius: R.sm, padding: '5px 8px', fontSize: '13px', fontWeight: 700, maxWidth: '180px', cursor: 'pointer' }}
          >
            {boards.map(b => (
              <option key={b.id} value={b.id} style={{ background: C.ink, color: C.onBrand }}>
                {b.isCrm ? '🏢 ' : '📋 '}{b.name}
              </option>
            ))}
          </select>
          <button onClick={() => setShowBoardEditor(true)} title="Gerenciar quadros" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', padding: '4px' }}>
            <Icon name="sliders" size={14} />
          </button>
        </div>

        <span style={{ width: '1px', height: '24px', background: 'rgba(247,244,237,0.3)' }} />
        <nav aria-label="Seções" style={{ display: 'flex', gap: '4px' }}>
          <Tab active={view === 'board'} icon="kanban" onClick={() => setView('board')}>Kanban</Tab>
          <Tab active={view === 'campaigns'} icon="megaphone" onClick={() => setView('campaigns')}>Campanhas</Tab>
          <Tab active={view === 'metrics'} icon="chart" onClick={() => setView('metrics')}>Métricas</Tab>
        </nav>

        <div style={{ flex: 1 }} />

        {view === 'board' && (
          <>
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
              <input
                type="search"
                aria-label="Buscar contatos"
                placeholder="Nome, telefone ou tag"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ padding: '8px 12px 8px 32px', borderRadius: R.pill, border: 'none', fontSize: '13px', width: '220px', outline: 'none', background: C.bg, color: C.ink, fontWeight: 500 }}
              />
            </div>
            <select aria-label="Filtrar por tag" value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={topSelect}>
              <option value="">Todas as tags</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select aria-label="Filtrar por coluna" value={columnFilter} onChange={e => setColumnFilter(e.target.value)} style={topSelect}>
              <option value="">Todas as colunas</option>
              {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <button onClick={() => setEditingColumn('new')} style={topBtn}><Icon name="plus" size={15} /> Coluna</button>
          </>
        )}
        <button onClick={() => void syncCrm()} style={topBtn} title="Traz os seus leads do CRM para o Kanban, nas colunas das etapas"><Icon name="repeat" size={15} /> Sincronizar CRM</button>
        <button onClick={() => xlsxInputRef.current?.click()} style={topBtn} title="Importe a planilha de leads exportada do CRM Incbook (.xlsx)"><Icon name="userPlus" size={15} /> Importar planilha</button>
        <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => void handleXlsxUpload(e)} />
        <button onClick={() => sendToBackground({ type: 'OPEN_MANUAL' })} style={topIconBtn} aria-label="Manual de uso" title="Manual de uso"><Icon name="book" size={17} /></button>
        <button onClick={() => setShowSettings(true)} style={topIconBtn} aria-label="Configurações" title="Configurações"><Icon name="sliders" size={17} /></button>
      </header>

      {view === 'campaigns' && <CampaignsPanel columns={columns} cards={cards} />}
      {view === 'metrics' && <MetricsPanel columns={columns} cards={cards} />}

      {view === 'board' && (
        <>
          {cards.length === 0 && (
            <div style={{ margin: '16px 22px 0', display: 'flex', gap: '14px', alignItems: 'center', background: C.accentSoft, border: `1px solid ${C.accentLine}`, borderRadius: R.md, padding: '14px 18px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: C.brand, color: C.onBrand, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="userPlus" size={20} />
              </div>
              <div style={{ flex: 1, fontSize: '13px', lineHeight: 1.5, color: C.inkSoft }}>
                <strong style={{ color: C.brand }}>Seu Kanban está vazio.</strong>{' '}
                Clique em <em>Adicionar contato</em> em qualquer coluna, ou abra uma conversa no WhatsApp Web e use o painel UP para salvar o lead já com o telefone.
              </div>
            </div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ flex: 1, overflowX: 'auto', padding: '18px 22px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              {visibleColumns.map(col => {
                return (
                  <Column
                    key={col.id}
                    column={col}
                    cards={cardsOf(col.id)}
                    filtering={filtering}
                    onAddCard={() => setNewCardColumn(col.id)}
                    onEditCard={setEditingCard}
                    onEditColumn={() => setEditingColumn(col)}
                  />
                )
              })}
            </div>
            <DragOverlay>{activeCard ? <CardItem card={activeCard} onEdit={() => {}} isDragging /> : null}</DragOverlay>
          </DndContext>
        </>
      )}

      {(editingCard || newCardColumn) && (
        <CardEditorModal
          card={editingCard ?? undefined}
          columnId={newCardColumn ?? editingCard?.columnId ?? columns[0]?.id}
          columns={columns}
          cards={cards}
          onSave={handleSaveCard}
          onDelete={editingCard ? handleDeleteCard : undefined}
          onClose={() => { setEditingCard(null); setNewCardColumn(null) }}
        />
      )}

      {editingColumn && (
        <ColumnEditor
          column={editingColumn === 'new' ? undefined : editingColumn}
          columns={columns}
          cards={cards}
          onSave={saveColumn}
          onMove={editingColumn === 'new' ? undefined : dir => moveColumn(editingColumn, dir)}
          onDelete={editingColumn === 'new' ? undefined : moveTo => deleteColumn(editingColumn, moveTo)}
          onClose={() => setEditingColumn(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => { setShowSettings(false); window.location.hash = '' }}
          onDataChanged={load}
          onResetColumns={resetColumns}
        />
      )}

      {showBoardEditor && (
        <BoardEditorModal
          boards={boards}
          activeBoardId={activeBoardId}
          onCreate={createBoard}
          onRename={renameBoard}
          onDelete={removeBoardConfirm}
          onSwitch={switchBoard}
          onClose={() => setShowBoardEditor(false)}
        />
      )}
    </div>
  )
}

function Tab({ active, icon, onClick, children }: { active: boolean; icon: IconName; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 14px', borderRadius: R.sm, border: 'none',
        background: active ? C.bg : 'transparent', color: active ? C.brand : 'rgba(247,244,237,0.85)',
        fontSize: '13px', fontWeight: 700,
      }}
    >
      <Icon name={icon} size={16} />
      {children}
    </button>
  )
}

const topBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: R.sm,
  border: '1px solid rgba(247,244,237,0.4)', background: 'transparent', color: C.onBrand, fontSize: '13px', fontWeight: 700,
}
const topIconBtn: React.CSSProperties = {
  width: '36px', height: '36px', borderRadius: R.sm, border: '1px solid rgba(247,244,237,0.3)',
  background: 'rgba(247,244,237,0.08)', color: C.onBrand, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const topSelect: React.CSSProperties = {
  padding: '8px 12px', borderRadius: R.sm, border: 'none', fontSize: '13px', outline: 'none', maxWidth: '170px',
  background: C.bg, color: C.ink, fontWeight: 600,
}

// ─── Column ───────────────────────────────────────────────────────────────────

function Column({
  column, cards, filtering, onAddCard, onEditCard, onEditColumn,
}: {
  column: KanbanColumn
  cards: KanbanCard[]
  filtering: boolean
  onAddCard: () => void
  onEditCard: (card: KanbanCard) => void
  onEditColumn: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <section
      ref={setNodeRef}
      aria-label={`Coluna ${column.title}`}
      style={{
        width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: isOver ? '#E3E0D3' : '#EFECE2', borderRadius: R.md, maxHeight: 'calc(100vh - 120px)',
        borderTop: `3px solid ${column.color}`,
      }}
    >
      <div style={{ padding: '10px 8px 8px 12px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: column.color, flexShrink: 0, marginTop: '5px' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: C.ink, lineHeight: 1.3 }}>{column.title}</h3>
          {column.description && (
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: C.muted, lineHeight: 1.35, fontWeight: 500 }}>{column.description}</p>
          )}
        </div>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.inkSoft, background: 'rgba(47,48,42,0.1)', borderRadius: R.pill, padding: '1px 8px', marginTop: '2px' }}>{cards.length}</span>
        <button
          onClick={onEditColumn}
          aria-label={`Editar coluna ${column.title}`}
          title="Editar coluna"
          style={{ width: '28px', height: '28px', borderRadius: R.sm, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <Icon name="pencil" size={14} />
        </button>
      </div>

      <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '2px 8px', minHeight: '56px' }}>
          {cards.length === 0 && (
            <div style={{ border: `1.5px dashed ${C.lineStrong}`, borderRadius: R.md, padding: '18px 10px', textAlign: 'center', fontSize: '12px', color: C.muted, fontWeight: 600 }}>
              {filtering ? 'Nenhum contato com este filtro' : 'Arraste contatos para cá'}
            </div>
          )}
          {cards.map(card => <SortableCard key={card.id} card={card} onEdit={onEditCard} />)}
        </div>
      </SortableContext>

      <button
        onClick={onAddCard}
        style={{ margin: '8px', padding: '9px 10px', borderRadius: R.sm, border: 'none', background: 'transparent', color: C.inkSoft, fontSize: '12.5px', fontWeight: 700, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '7px' }}
      >
        <Icon name="plus" size={15} /> Adicionar contato
      </button>
    </section>
  )
}

function SortableCard({ card, onEdit }: { card: KanbanCard; onEdit: (c: KanbanCard) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardItem card={card} onEdit={onEdit} />
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function CardItem({ card, onEdit, isDragging = false }: { card: KanbanCard; onEdit: (c: KanbanCard) => void; isDragging?: boolean }) {
  const daysStill = Math.floor((Date.now() - card.columnChangedAt) / DAY)
  const stale = daysStill >= 7

  return (
    <div
      onClick={() => !isDragging && onEdit(card)}
      style={{
        background: C.surface, borderRadius: R.md, padding: '11px 12px', marginBottom: '8px',
        boxShadow: isDragging ? SHADOW.pop : SHADOW.card, border: `1px solid ${C.line}`,
        cursor: isDragging ? 'grabbing' : 'pointer', userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: C.brand, color: C.onBrand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, flexShrink: 0 }}>
          {card.contactName[0]?.toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.contactName}</p>
          <p style={{ margin: 0, fontSize: '11px', color: card.phone ? C.muted : C.danger, fontWeight: 600 }}>{card.phone ? formatPhone(card.phone) : 'sem telefone'}</p>
        </div>
        {card.phone && (
          <button
            onClick={e => { e.stopPropagation(); void sendToBackground({ type: 'OPEN_CHAT', payload: { phone: card.phone } }) }}
            onPointerDown={e => e.stopPropagation()}
            aria-label={`Abrir conversa com ${card.contactName}`}
            title="Abrir conversa no WhatsApp"
            style={{ width: '30px', height: '30px', borderRadius: R.sm, border: `1px solid ${C.accentLine}`, background: C.accentSoft, color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <Icon name="chat" size={15} />
          </button>
        )}
      </div>

      {card.lastMessage && (
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: C.inkSoft, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{card.lastMessage}</p>
      )}

      {(card.tags.length > 0 || card.notes || daysStill >= 1) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px', alignItems: 'center' }}>
          {card.tags.map(tag => (
            <span key={tag} style={{ fontSize: '10.5px', fontWeight: 700, background: tagColor(tag).bg, color: tagColor(tag).fg, borderRadius: R.pill, padding: '2px 8px' }}>{tag}</span>
          ))}
          <span style={{ flex: 1 }} />
          {card.notes && <span title="Tem notas" style={{ color: C.muted, display: 'flex' }}><Icon name="note" size={13} /></span>}
          {daysStill >= 1 && (
            <span title="Tempo nesta etapa" style={{ fontSize: '10.5px', fontWeight: 700, color: stale ? C.warn : C.muted, background: stale ? C.warnSoft : 'transparent', borderRadius: R.pill, padding: stale ? '2px 8px' : 0, display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Icon name="clock" size={11} /> {daysStill} d
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const TAG_PALETTE = [
  { bg: C.accentSoft, fg: C.brand }, { bg: C.infoSoft, fg: C.info }, { bg: C.warnSoft, fg: C.warn },
  { bg: '#EFE4F0', fg: '#6B4A70' }, { bg: C.okSoft, fg: C.ok }, { bg: C.dangerSoft, fg: C.danger },
]

/** Cor estável por tag (mesma tag, mesma cor). */
function tagColor(tag: string) {
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TAG_PALETTE[h % TAG_PALETTE.length]
}

// ─── Card Editor ──────────────────────────────────────────────────────────────

// ─── Board Editor ─────────────────────────────────────────────────────────────

function BoardEditorModal({
  boards, activeBoardId, onCreate, onRename, onDelete, onSwitch, onClose,
}: {
  boards: KanbanBoard[]
  activeBoardId: string
  onCreate: (name: string) => Promise<void>
  onRename: (boardId: string, name: string) => Promise<void>
  onDelete: (boardId: string) => Promise<void>
  onSwitch: (boardId: string) => Promise<void>
  onClose: () => void
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    await onCreate(name)
    setNewName('')
    setBusy(false)
    onClose()
  }

  async function handleRename(boardId: string) {
    const name = editName.trim()
    if (!name) return
    setBusy(true)
    await onRename(boardId, name)
    setEditingId(null)
    setBusy(false)
  }

  async function handleSwitch(boardId: string) {
    if (boardId === activeBoardId) { onClose(); return }
    await onSwitch(boardId)
    onClose()
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Gerenciar quadros" style={modalStyle(440)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: C.brand }}>Gerenciar quadros</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {boards.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: R.md, border: `1.5px solid ${b.id === activeBoardId ? C.brand : C.line}`, background: b.id === activeBoardId ? C.accentSoft : C.surface }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>{b.isCrm ? '🏢' : '📋'}</span>

              {editingId === b.id ? (
                <>
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void handleRename(b.id); if (e.key === 'Escape') setEditingId(null) }}
                    style={{ ...inputStyle, flex: 1, padding: '5px 8px', fontSize: '13px' }}
                  />
                  <button onClick={() => void handleRename(b.id)} disabled={busy} style={{ ...primaryBtn(), padding: '5px 12px', fontSize: '12px' }}>Salvar</button>
                  <button onClick={() => setEditingId(null)} style={{ ...ghostBtn, padding: '5px 10px', fontSize: '12px' }}>Cancelar</button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => void handleSwitch(b.id)}
                    style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 700, color: b.id === activeBoardId ? C.brand : C.ink }}>{b.name}</span>
                    {b.isCrm && <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, background: C.brand, color: C.onBrand, borderRadius: R.pill, padding: '1px 7px' }}>CRM</span>}
                    {b.id === activeBoardId && <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: C.brand }}>• ativo</span>}
                  </button>
                  {!b.isCrm && (
                    <button
                      onClick={() => { setEditingId(b.id); setEditName(b.name) }}
                      title="Renomear"
                      style={{ width: '30px', height: '30px', borderRadius: R.sm, border: `1px solid ${C.line}`, background: 'transparent', color: C.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                  )}
                  {b.id !== DEFAULT_BOARD_ID && !b.isCrm && (
                    <button
                      onClick={() => void onDelete(b.id)}
                      title="Excluir quadro"
                      style={{ width: '30px', height: '30px', borderRadius: R.sm, border: `1px solid ${C.dangerSoft}`, background: C.dangerSoft, color: C.danger, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: C.ink }}>Criar novo quadro de prospecção</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleCreate()}
              placeholder="Nome do quadro (ex.: Lançamento Lisboa)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={() => void handleCreate()} disabled={busy || !newName.trim()} style={primaryBtn()}>
              <Icon name="plus" size={15} /> Criar
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.muted, lineHeight: 1.5 }}>
            Quadros livres são independentes do CRM — úteis para prospecção de lançamentos, eventos ou campanhas específicas.
          </p>
        </div>
      </div>
    </div>
  )
}

function CardEditorModal({
  card, columnId, columns, cards, onSave, onDelete, onClose,
}: {
  card?: KanbanCard
  columnId: string
  columns: KanbanColumn[]
  cards: KanbanCard[]
  onSave: (card: KanbanCard) => void
  onDelete?: (id: string) => void
  onClose: () => void
}) {
  const { confirm } = useFeedback()
  const isNew = !card
  const [contactName, setContactName] = useState(card?.contactName ?? '')
  const [phoneRaw, setPhoneRaw] = useState(card?.phone ?? '')
  const [lastMessage, setLastMessage] = useState(card?.lastMessage ?? '')
  const [notes, setNotes] = useState(card?.notes ?? '')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(card?.tags ?? [])
  const [colId, setColId] = useState(card?.columnId ?? columnId)
  const [error, setError] = useState<string | null>(null)

  const phone = normalizePhone(phoneRaw)

  function commitTag() {
    const t = tagInput.trim().replace(/,$/, '')
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }

  function addTag(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTag()
    }
  }

  function handleSave() {
    setError(null)
    if (!contactName.trim()) return setError('Informe o nome do contato.')
    if (!phone) return setError('Informe um telefone válido, com DDD. Ex.: (31) 99999-9999.')
    if (cards.some(c => c.phone === phone && c.id !== card?.id)) {
      return setError('Já existe um card com este telefone.')
    }
    const now = Date.now()
    const finalTags = tagInput.trim() && !tags.includes(tagInput.trim()) ? [...tags, tagInput.trim()] : tags
    const base: KanbanCard = {
      id: card?.id ?? `card_${now}_${Math.random().toString(36).slice(2)}`,
      contactName: contactName.trim(),
      phone,
      columnId: card?.columnId ?? colId,
      columnChangedAt: card?.columnChangedAt ?? now,
      columnHistory: card?.columnHistory ?? [{ columnId: colId, at: now }],
      tags: finalTags,
      notes,
      lastMessage,
      lastMessageAt: card?.lastMessageAt ?? now,
      order: card?.order ?? cards.reduce((m, c) => Math.max(m, c.order), 0) + 1,
      createdAt: card?.createdAt ?? now,
      updatedAt: now,
    }
    onSave(applyColumnChange(base, colId, now))
  }

  async function handleDelete() {
    if (!card) return
    const ok = await confirm({ title: 'Excluir contato', message: `Excluir "${card.contactName}" do Kanban? Os follow-ups agendados continuam na fila.`, confirmLabel: 'Excluir', danger: true })
    if (ok) onDelete?.(card.id)
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={isNew ? 'Novo contato' : 'Editar contato'} style={modalStyle(460)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: C.brand }}>{isNew ? 'Novo contato' : 'Editar contato'}</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label style={labelStyle}>
              Nome *
              <input style={inputStyle} value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Nome do contato" autoFocus />
            </label>
            <label style={labelStyle}>
              Telefone *
              <input style={inputStyle} value={phoneRaw} onChange={e => setPhoneRaw(e.target.value)} placeholder="(31) 99999-9999" />
              <span style={{ fontSize: '11px', fontWeight: 600, color: phone ? C.ok : C.muted }}>{phone ? formatPhone(phone) : 'DDD + número'}</span>
            </label>
          </div>

          <label style={labelStyle}>
            Etapa
            <select style={inputStyle} value={colId} onChange={e => setColId(e.target.value)}>
              {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            Resumo da última conversa
            <input style={inputStyle} value={lastMessage} onChange={e => setLastMessage(e.target.value)} placeholder="Ex.: pediu simulação do apto 302" />
          </label>

          <div>
            <label style={labelStyle}>
              Tags
              <input style={inputStyle} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={addTag} onBlur={commitTag} placeholder="Digite e pressione Enter (ex.: mcmv, vip)" />
            </label>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                {tags.map(t => (
                  <button key={t} onClick={() => setTags(tags.filter(x => x !== t))} title="Clique para remover" aria-label={`Remover tag ${t}`}
                    style={{ fontSize: '12px', fontWeight: 700, background: tagColor(t).bg, color: tagColor(t).fg, borderRadius: R.pill, padding: '3px 10px', border: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {t} <Icon name="x" size={11} strokeWidth={2.4} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <label style={labelStyle}>
            Notas internas
            <textarea style={{ ...inputStyle, minHeight: '84px', resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Privadas: não aparecem no WhatsApp" />
          </label>

          {error && <div role="alert" style={errorStyle}>{error}</div>}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={handleSave} style={{ ...primaryBtn(), flex: 1 }}>{isNew ? 'Adicionar contato' : 'Salvar alterações'}</button>
            {!isNew && card && (
              <>
                <button
                  style={ghostBtn}
                  disabled={!card.phone}
                  onClick={() => sendToBackground({ type: 'OPEN_CHAT', payload: { phone: card.phone } })}
                  title="Abrir conversa no WhatsApp"
                >
                  <Icon name="chat" size={15} /> Abrir conversa
                </button>
                <button style={dangerBtn} onClick={handleDelete} aria-label="Excluir contato" title="Excluir"><Icon name="trash" size={15} /></button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
