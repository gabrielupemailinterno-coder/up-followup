/**
 * Parser da planilha de leads exportada do CRM Incbook.
 * Colunas esperadas (na ordem padrão da exportação):
 *   Nome | Apelido | Email | Telefone | Data de Entrada | Campanha de Aquisição |
 *   Empreendimentos | Persona | Usuario que Cadastrou | Força de Venda |
 *   Usuário Atendendo | Funil | Fase do Funil | Tempo na fase | Tipo última atividade | Data última movimentação
 *
 * Funciona mesmo que colunas extras sejam adicionadas pelo usuário.
 */
import * as XLSX from 'xlsx'
import type { KanbanCard, KanbanColumn } from './types'
import { normalizePhone } from './phone'

export interface ImportedLead {
  name: string
  phone: string
  email: string
  tags: string[]       // empreendimento(s) + campanha + persona
  funil: string        // "UP - Repescagem" etc.
  stage: string        // fase do funil → coluna
  enteredAt: number
  lastMovedAt: number
}

export interface ImportResult {
  leads: ImportedLead[]
  skipped: number      // linhas sem nome nem telefone
  total: number
}

function col(headers: string[], ...candidates: string[]): number {
  const lc = headers.map(h => h?.toString().toLowerCase().trim() ?? '')
  for (const c of candidates) {
    const i = lc.indexOf(c.toLowerCase().trim())
    if (i >= 0) return i
  }
  return -1
}

function parseDate(v: unknown): number {
  if (!v) return 0
  if (typeof v === 'number') {
    // número de série do Excel (dias desde 1899-12-30)
    const d = XLSX.SSF.parse_date_code(v)
    return new Date(d.y, d.m - 1, d.d).getTime()
  }
  const s = String(v).trim()
  // DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime()
  const t = Date.parse(s)
  return isNaN(t) ? 0 : t
}

export function parseXlsx(buffer: ArrayBuffer): ImportResult {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (rows.length < 2) return { leads: [], skipped: 0, total: 0 }

  const headers = rows[0] as string[]
  const iNome      = col(headers, 'Nome')
  const iEmail     = col(headers, 'Email')
  const iPhone     = col(headers, 'Telefone')
  const iEntrada   = col(headers, 'Data de Entrada')
  const iCampanha  = col(headers, 'Campanha de Aquisição', 'Campanha de Aquisicao')
  const iEmp       = col(headers, 'Empreendimentos', 'Empreendimento')
  const iPersona   = col(headers, 'Persona')
  const iFunil     = col(headers, 'Funil')
  const iFase      = col(headers, 'Fase do Funil', 'Fase')
  const iMovida    = col(headers, 'Data da última movimentação no Funil', 'Data da ultima movimentacao no Funil', 'Ultima movimentacao')

  const leads: ImportedLead[] = []
  let skipped = 0

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[]
    const name  = iNome  >= 0 ? String(r[iNome]  ?? '').trim() || '' : ''
    const rawPh = iPhone >= 0 ? String(r[iPhone]  ?? '').trim() : ''
    const phone = normalizePhone(rawPh) ?? ''

    if (!name && !phone) { skipped++; continue }

    const tags: string[] = []

    // empreendimentos (pode vir "Park Alterosa, Residencial Lisboa")
    const empRaw = iEmp >= 0 ? String(r[iEmp] ?? '').trim() : ''
    if (empRaw) {
      for (const e of empRaw.split(/[,;]+/)) {
        const t = e.trim()
        if (t) tags.push(t)
      }
    }

    const campanha = iCampanha >= 0 ? String(r[iCampanha] ?? '').trim() : ''
    if (campanha) tags.push(campanha)

    const persona  = iPersona  >= 0 ? String(r[iPersona]  ?? '').trim() : ''
    if (persona) tags.push(persona)

    leads.push({
      name,
      phone,
      email:       iEmail   >= 0 ? String(r[iEmail]   ?? '').trim() : '',
      tags,
      funil:       iFunil   >= 0 ? String(r[iFunil]   ?? '').trim() : '',
      stage:       iFase    >= 0 ? String(r[iFase]    ?? '').trim() : '',
      enteredAt:   iEntrada >= 0 ? parseDate(r[iEntrada]) : 0,
      lastMovedAt: iMovida  >= 0 ? parseDate(r[iMovida] as unknown)  : 0,
    })
  }

  return { leads, skipped, total: rows.length - 1 }
}

/** Mescla os leads importados nas colunas do Kanban.
 *  - Cria coluna se não existir ainda (pela fase do funil).
 *  - Se o lead já existe (por telefone), atualiza tags e stage; não move se estava na coluna certa.
 *  - Se não existe, cria card novo.
 *  Devolve as colunas e os cards finais, prontos para salvar.
 */
export function mergeImportedLeads(
  leads: ImportedLead[],
  columns: KanbanColumn[],
  cards: KanbanCard[],
  newId: () => string,
  now: number
): { columns: KanbanColumn[]; cards: KanbanCard[]; created: number; updated: number } {
  const cols = [...columns]
  const result = [...cards]
  let created = 0, updated = 0

  // índice de cards por telefone normalizado
  const byPhone = new Map<string, KanbanCard>()
  for (const c of result) {
    if (c.phone) byPhone.set(c.phone, c)
  }

  // cores padrão para colunas novas criadas pelo import
  const AUTO_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']
  let colorIdx = cols.length % AUTO_COLORS.length

  // helper: encontra ou cria coluna pelo stage name
  function getOrCreateCol(stageName: string): string {
    if (!stageName) {
      // sem fase → primeira coluna
      if (cols.length === 0) {
        const id = `col_${newId()}`
        cols.push({ id, title: 'Importados', color: AUTO_COLORS[colorIdx++ % AUTO_COLORS.length], order: 0, createdAt: now })
        return id
      }
      return cols[0].id
    }
    const lc = stageName.toLowerCase()
    const found = cols.find(c => c.title.toLowerCase() === lc)
    if (found) return found.id
    const id = `col_${newId()}`
    cols.push({ id, title: stageName, color: AUTO_COLORS[colorIdx++ % AUTO_COLORS.length], order: cols.length, createdAt: now })
    return id
  }

  for (const lead of leads) {
    const colId = getOrCreateCol(lead.stage)
    const existing = lead.phone ? byPhone.get(lead.phone) : undefined

    // merge de tags sem duplicar
    function mergeTags(old: string[], incoming: string[]): string[] {
      const s = new Set(old)
      for (const t of incoming) s.add(t)
      return [...s]
    }

    if (existing) {
      const idx = result.indexOf(existing)
      result[idx] = {
        ...existing,
        tags: mergeTags(existing.tags, lead.tags),
        crmStage: lead.stage || existing.crmStage,
        // só move se estava numa coluna "pior" (a coluna nova é a fase do CRM)
        columnId: colId,
        updatedAt: now,
      }
      updated++
    } else {
      const card: KanbanCard = {
        id: newId(),
        contactName: lead.name,
        phone: lead.phone,
        columnId: colId,
        columnChangedAt: lead.lastMovedAt || now,
        columnHistory: [],
        crmStage: lead.stage,
        tags: lead.tags,
        notes: lead.email ? `E-mail: ${lead.email}` : '',
        lastMessage: '',
        lastMessageAt: lead.lastMovedAt || lead.enteredAt || now,
        order: 0,
        createdAt: lead.enteredAt || now,
        updatedAt: now,
      }
      result.push(card)
      if (lead.phone) byPhone.set(lead.phone, card)
      created++
    }
  }

  // recalcula order dentro de cada coluna
  const orderMap = new Map<string, number>()
  for (const c of result) {
    const o = orderMap.get(c.columnId) ?? 0
    c.order = o
    orderMap.set(c.columnId, o + 1)
  }

  return { columns: cols, cards: result, created, updated }
}
