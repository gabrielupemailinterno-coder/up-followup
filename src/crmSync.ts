/**
 * Sincronização CRM ↔ Kanban, parte pura (sem DOM): casar leads da tabela do CRM com os cards,
 * mapear etapa do CRM ↔ coluna do Kanban e montar o relatório.
 */

import type { KanbanCard, KanbanColumn } from './types'
import { normalizePhone } from './phone'
import { samePhone } from './crm'

/** Uma linha da tela Leads do CRM (colunas Nome, Telefone, Com quem está, Etapa). */
export interface TableLead {
  name: string
  phones: string[]
  owner: string
  stage: string
}

export interface SyncReport {
  read: number
  mine: number
  created: number
  moved: number
  unchanged: number
  noPhone: number
  newColumns: string[]
}

export const normTitle = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()

/** Leads do corretor: "Com quem está" contém o nome configurado (sem acento/maiúsculas). */
export function filterMine(leads: TableLead[], ownerName: string): TableLead[] {
  const me = normTitle(ownerName)
  if (!me) return []
  return leads.filter(l => normTitle(l.owner).includes(me))
}

/** Coluna do Kanban para uma etapa do CRM: mapeamento salvo, senão coluna com o mesmo nome. */
export function columnForStage(stage: string, columns: KanbanColumn[], stageMap: Record<string, string>): KanbanColumn | null {
  const key = normTitle(stage)
  const mapped = stageMap[key]
  if (mapped) {
    const c = columns.find(col => col.id === mapped)
    if (c) return c
  }
  return columns.find(col => normTitle(col.title) === key) ?? null
}

/** Etapa do CRM para uma coluna (inverso do mapeamento); null se a coluna não corresponde a nenhuma etapa conhecida. */
export function stageForColumn(columnId: string, columns: KanbanColumn[], stageMap: Record<string, string>, knownStages: string[]): string | null {
  for (const stage of knownStages) {
    if (columnForStage(stage, columns, stageMap)?.id === columnId) return stage
  }
  return null
}

const COLORS = ['#56788A', '#4E8A86', '#8C6A8F', '#B08A3E', '#3F6B4B', '#7B896F', '#A5432F']

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s|\/)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())

export function mergeIntoKanban(
  cards: KanbanCard[],
  columns: KanbanColumn[],
  leads: TableLead[],
  stageMap: Record<string, string>,
  now: number,
  newId: () => string,
): { cards: KanbanCard[]; columns: KanbanColumn[]; report: SyncReport } {
  const nextCards = [...cards]
  const nextColumns = [...columns]
  const report: SyncReport = { read: leads.length, mine: leads.length, created: 0, moved: 0, unchanged: 0, noPhone: 0, newColumns: [] }
  let maxOrder = nextCards.reduce((m, c) => Math.max(m, c.order), 0)

  for (const lead of leads) {
    const phone = lead.phones.map(p => normalizePhone(p)).find((p): p is string => !!p)
    if (!phone) { report.noPhone++; continue }
    let col = columnForStage(lead.stage, nextColumns, stageMap)
    if (!col && lead.stage.trim()) {
      col = { id: `col-crm-${normTitle(lead.stage).replace(/\s+/g, '-')}`, title: titleCase(lead.stage.trim()), color: COLORS[nextColumns.length % COLORS.length], order: nextColumns.length, createdAt: now }
      nextColumns.push(col)
      report.newColumns.push(col.title)
    }
    if (!col) col = nextColumns[0]

    const idx = nextCards.findIndex(c => c.phone && samePhone(c.phone, phone))
    const stage = lead.stage.trim() || undefined   // tabela sem coluna de etapa: não move e não liga a etapa
    if (!stage && idx >= 0) { report.unchanged++; continue }
    if (idx < 0) {
      nextCards.push({
        id: newId(), contactName: lead.name, phone, columnId: col.id, columnChangedAt: now,
        columnHistory: [{ columnId: col.id, at: now }], tags: [], notes: '', lastMessage: '', lastMessageAt: 0,
        order: ++maxOrder, createdAt: now, updatedAt: now, crmStage: stage,
      })
      report.created++
      continue
    }
    const card = nextCards[idx]
    // Só move quando a etapa mudou NO CRM desde a última sincronização (o que você moveu no Kanban fica).
    if (card.crmStage === lead.stage || (card.crmStage === undefined && card.columnId === col.id)) {
      report.unchanged++
      if (card.crmStage !== lead.stage) nextCards[idx] = { ...card, crmStage: lead.stage }
      continue
    }
    nextCards[idx] = card.columnId === col.id
      ? { ...card, crmStage: lead.stage, updatedAt: now }
      : { ...card, columnId: col.id, columnChangedAt: now, columnHistory: [...card.columnHistory, { columnId: col.id, at: now }].slice(-50), crmStage: lead.stage, updatedAt: now }
    if (card.columnId !== col.id) report.moved++
    else report.unchanged++
  }
  return { cards: nextCards, columns: nextColumns, report }
}

export function describeReport(r: SyncReport, capped: boolean): string {
  const parts = [`${r.mine} lead(s) seus de ${r.read} lidos`, `${r.created} novo(s) no Kanban`, `${r.moved} movido(s)`, `${r.unchanged} sem mudança`]
  if (r.noPhone) parts.push(`${r.noPhone} sem telefone`)
  if (r.newColumns.length) parts.push(`colunas criadas: ${r.newColumns.join(', ')}`)
  return `Sincronizado: ${parts.join(' · ')}.${capped ? ' Parou no limite de páginas (Configurações > CRM).' : ''}`
}
