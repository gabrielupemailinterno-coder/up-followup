/**
 * "Código do Claude": um JSON com quadros, etapas, contatos, campanhas, agendamentos etc.
 * Aqui ele é conferido e transformado na lista de mudanças. Função pura: não grava nada.
 *
 * Regras: só acrescenta (nunca apaga, move, renomeia nem substitui); aplicar duas vezes não duplica;
 * campanha entra como rascunho; havendo qualquer erro, nada deve ser gravado.
 */

import type {
  AppSettings, Campaign, CampaignAudience, KanbanBoard, KanbanCard, KanbanColumn, MessageLink,
  Recurrence, ScheduledMessage, Task, Template,
} from './types'
import { formatPhone, normalizePhone } from './phone'
import { buildItems, validateCampaign } from './campaign'
import { renderTemplate } from './templates'
import { phoneKey } from './groupImport'
import { DEFAULT_LINK, describeLink, normalizeLink } from './link'
import { DEFAULT_COLUMNS } from './storage'

export interface PlanState {
  boards: KanbanBoard[]
  columns: Record<string, KanbanColumn[]>   // por id de quadro
  cards: Record<string, KanbanCard[]>       // por id de quadro
  campaigns: Campaign[]
  schedules: ScheduledMessage[]
  templates: Template[]
  tasks: Task[]
  settings: AppSettings
}

export interface PlanChanges {
  boards: KanbanBoard[] | null                  // lista completa, só se houver quadro novo
  columns: Record<string, KanbanColumn[]>       // só os quadros alterados (lista completa)
  cards: Record<string, KanbanCard[]>           // só os quadros alterados (lista completa)
  campaigns: Campaign[]                         // só as novas
  schedules: ScheduledMessage[]                 // só os novos
  templates: Template[] | null                  // lista completa, só se houver nova
  tasks: Task[]                                 // só as novas
  settings: Partial<AppSettings> | null
}

export interface PlanSection {
  title: string
  lines: string[]
}

export type PlanResult =
  | { ok: false; errors: string[] }
  | {
      ok: true
      id: string
      name: string
      sections: PlanSection[]
      warnings: string[]   // envio automático etc.: aparecem destacados antes do Aplicar
      skipped: string[]    // já existia
      total: number        // quantas coisas serão criadas ou alteradas
      changes: PlanChanges
    }

const FIELDS = ['evler', 'id', 'nome', 'quadros', 'contatos', 'campanhas', 'agendamentos', 'respostasRapidas', 'tarefas', 'pausa']
const COLORS = ['#3F6B4B', '#56654F', '#B08A3E', '#8C6A8F', '#A5432F', '#4A6D8C']
const RECURRENCE: Record<string, Recurrence> = { nao: 'none', 'não': 'none', diario: 'daily', 'diário': 'daily', semanal: 'weekly', mensal: 'monthly' }

type Obj = Record<string, unknown>

const key = (s: string) => s.trim().toLowerCase()
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** "AAAA-MM-DD HH:MM" no horário do computador. */
export function parseWhen(value: string): number | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const date = new Date(y, mo - 1, d, h, mi)
  const same = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi
  return same ? date.getTime() : null
}

export function formatWhen(at: number): string {
  return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Tira o texto em volta e as cercas ``` que costumam vir junto ao copiar. */
export function extractJson(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Não encontrei o código. Copie o bloco inteiro, do primeiro { ao último }.')
  return JSON.parse(raw.slice(start, end + 1))
}

/** "link": { "url", "texto", "formato": "botao" | "cartao", "botao" } */
function readLink(v: unknown, where: string, errors: string[]): MessageLink | undefined {
  if (v === undefined) return undefined
  const format = isObj(v) ? key(text(v.formato) || 'botao') : ''
  if (!isObj(v) || !['botao', 'botão', 'cartao', 'cartão'].includes(format)) {
    errors.push(`${where}: "link" precisa de "url" e "formato" (botao ou cartao).`)
    return undefined
  }
  const r = normalizeLink({
    url: text(v.url),
    text: text(v.texto) || DEFAULT_LINK.text,
    style: format.startsWith('b') ? 'button' : 'card',
    label: text(v.botao) || DEFAULT_LINK.label,
  })
  if (!r.ok) errors.push(`${where}: ${r.error}`)
  return r.ok ? r.link : undefined
}

export function buildPlan(raw: string, state: PlanState, now = Date.now()): PlanResult {
  let data: unknown
  try {
    data = extractJson(raw)
  } catch (e) {
    const msg = e instanceof SyntaxError ? 'O código está incompleto ou foi alterado na cópia. Copie de novo, inteiro.' : (e as Error).message
    return { ok: false, errors: [msg] }
  }
  if (!isObj(data) || data.evler !== 1) return { ok: false, errors: ['Este não é um código da extensão (falta "evler": 1). Peça um novo ao Claude.'] }

  const errors: string[] = []
  const warnings: string[] = []
  const skipped: string[] = []
  const id = text(data.id)
  const name = text(data.nome) || id
  if (!id) errors.push('O código precisa de um "id".')
  const unknown = Object.keys(data).filter(k => !FIELDS.includes(k))
  if (unknown.length) errors.push(`Partes que esta versão não entende: ${unknown.join(', ')}.`)

  const list = (field: string): Obj[] => {
    const v = (data as Obj)[field]
    if (v === undefined) return []
    if (!Array.isArray(v) || !v.every(isObj)) {
      errors.push(`"${field}" precisa ser uma lista.`)
      return []
    }
    return v
  }

  let seq = 0
  const newId = (prefix: string) => `${prefix}_${now}_${++seq}_${Math.random().toString(36).slice(2, 6)}`

  // Cópias de trabalho: o estado recebido não é alterado.
  const boards = [...state.boards]
  const columns: Record<string, KanbanColumn[]> = { ...state.columns }
  const cards: Record<string, KanbanCard[]> = { ...state.cards }
  const changedColumns = new Set<string>()
  const changedCards = new Set<string>()
  let boardsChanged = false

  const boardLines: string[] = []
  const contactLines: string[] = []

  const findBoard = (n: string) => boards.find(b => key(b.name) === key(n))
  /** Quadro pelo nome; sem nome = quadro principal (o primeiro). */
  const boardFor = (v: unknown, where: string): KanbanBoard | null => {
    const n = text(v)
    if (!n) return boards[0] ?? null
    const found = findBoard(n)
    if (!found) errors.push(`${where}: o quadro "${n}" não existe e não está em "quadros".`)
    return found ?? null
  }
  const findColumn = (boardId: string, n: string) => (columns[boardId] ?? []).find(c => key(c.title) === key(n))
  const columnFor = (board: KanbanBoard, v: unknown, where: string): KanbanColumn | null => {
    const n = text(v)
    const found = findColumn(board.id, n)
    if (!found) errors.push(`${where}: a etapa "${n}" não existe no quadro "${board.name}".`)
    return found ?? null
  }

  // ── Quadros e etapas ────────────────────────────────────────────────────────
  for (const [i, q] of list('quadros').entries()) {
    const boardName = text(q.nome)
    if (!boardName) { errors.push(`Quadro ${i + 1}: falta o nome.`); continue }
    const stages = q.etapas === undefined ? [] : q.etapas
    if (!Array.isArray(stages) || !stages.every(isObj)) { errors.push(`Quadro "${boardName}": "etapas" precisa ser uma lista.`); continue }
    let board = findBoard(boardName)
    const isNew = !board
    if (!board) {
      board = { id: newId('board'), name: boardName, createdAt: now }
      boards.push(board)
      boardsChanged = true
      // Quadro novo com etapas informadas nasce só com elas; sem etapas, usa as padrão.
      columns[board.id] = stages.length ? [] : DEFAULT_COLUMNS.map(c => ({ ...c }))
      changedColumns.add(board.id)
      cards[board.id] = []
      boardLines.push(`Quadro novo: ${boardName}`)
    }
    for (const [j, s] of (stages as Obj[]).entries()) {
      const title = text(s.nome)
      if (!title) { errors.push(`Quadro "${boardName}", etapa ${j + 1}: falta o nome.`); continue }
      if (findColumn(board.id, title)) {
        if (!isNew) skipped.push(`Etapa "${title}" já existe em "${board.name}".`)
        continue
      }
      const current = columns[board.id] ?? []
      const color = /^#[0-9a-f]{6}$/i.test(text(s.cor)) ? text(s.cor) : COLORS[current.length % COLORS.length]
      columns[board.id] = [...current, {
        id: newId('col'), title, color, createdAt: now,
        description: text(s.descricao) || undefined,
        order: current.reduce((m, c) => Math.max(m, c.order), -1) + 1,
      }]
      changedColumns.add(board.id)
      boardLines.push(`Etapa nova em "${board.name}": ${title}`)
    }
    if (!(columns[board.id] ?? []).length) errors.push(`Quadro "${boardName}": ficou sem nenhuma etapa.`)
  }

  // ── Contatos ────────────────────────────────────────────────────────────────
  for (const [i, c] of list('contatos').entries()) {
    const who = text(c.nome)
    const where = `Contato ${i + 1}${who ? ` (${who})` : ''}`
    const phone = normalizePhone(text(c.telefone))
    if (!phone) { errors.push(`${where}: telefone inválido. Use DDD + número.`); continue }
    const board = boardFor(c.quadro, where)
    if (!board) continue
    const column = text(c.etapa)
      ? columnFor(board, c.etapa, where)
      : [...(columns[board.id] ?? [])].sort((a, b) => a.order - b.order)[0]
    if (!column) continue
    const tags = Array.isArray(c.tags) ? c.tags.map(text).filter(Boolean) : []
    const current = cards[board.id] ?? []
    const at = current.findIndex(x => x.phone && phoneKey(x.phone) === phoneKey(phone))
    if (at >= 0) {
      const add = tags.filter(t => !current[at].tags.includes(t))
      if (!add.length) { skipped.push(`${current[at].contactName} já está em "${board.name}".`); continue }
      cards[board.id] = current.map((x, n) => (n === at ? { ...x, tags: [...x.tags, ...add], updatedAt: now } : x))
      contactLines.push(`${current[at].contactName}: ganha a(s) tag(s) ${add.join(', ')} (continua onde está)`)
    } else {
      cards[board.id] = [...current, {
        id: newId('card'), contactName: who || formatPhone(phone), phone,
        columnId: column.id, columnChangedAt: now, columnHistory: [{ columnId: column.id, at: now }],
        tags, notes: '', lastMessage: '', lastMessageAt: now,
        order: current.reduce((m, x) => Math.max(m, x.order), -1) + 1, createdAt: now, updatedAt: now,
      }]
      contactLines.push(`${who || formatPhone(phone)} → ${board.name} / ${column.title}`)
    }
    changedCards.add(board.id)
  }

  // ── Campanhas (sempre rascunho) ─────────────────────────────────────────────
  const campaigns: Campaign[] = []
  const campaignLines: string[] = []
  for (const [i, c] of list('campanhas').entries()) {
    const title = text(c.nome)
    const where = `Campanha ${title ? `"${title}"` : i + 1}`
    if (title && [...state.campaigns, ...campaigns].some(x => key(x.name) === key(title))) {
      skipped.push(`${where} já existe.`)
      continue
    }
    const board = boardFor(c.quadro, where)
    if (!board) continue
    const column = text(c.etapa) ? columnFor(board, c.etapa, where) : null
    const moveTo = text(c.moverPara) ? columnFor(board, c.moverPara, where) : null
    const tag = text(c.tag)

    const pasted: string[] = []
    for (const p of Array.isArray(c.contatos) ? c.contatos : []) {
      const phone = isObj(p) ? normalizePhone(text(p.telefone)) : null
      if (!isObj(p) || !phone) errors.push(`${where}: há contato com telefone inválido.`)
      else pasted.push(`${text(p.nome).replace(/[;,\t\n]/g, ' ')};+${phone}`)
    }
    const fromKanban = Boolean(text(c.etapa) || tag)
    if (!fromKanban && pasted.length === 0) { errors.push(`${where}: diga o público ("etapa", "tag" ou "contatos").`); continue }
    if (text(c.etapa) && !column) continue
    const audience: CampaignAudience = !fromKanban
      ? { kind: 'pasted' }
      : { kind: pasted.length ? 'both' : 'kanban', columnId: column?.id, tag: tag || undefined }
    const { items } = buildItems({ audience, cards: cards[board.id] ?? [], pastedText: pasted.join('\n') })

    const variants = Array.isArray(c.mensagens) ? c.mensagens.map(text).filter(Boolean) : []
    const vars: Record<string, string> = {}
    if (isObj(c.variaveis)) for (const [k, v] of Object.entries(c.variaveis)) vars[k] = String(v)
    const interval = Array.isArray(c.intervalo) ? c.intervalo.map(Number) : [60, 120]
    const [minSec, maxSec] = interval
    if (interval.length !== 2 || !interval.every(Number.isFinite)) { errors.push(`${where}: "intervalo" precisa ter dois números, em segundos.`); continue }
    const problems = validateCampaign({ name: title, variants, vars, minSec, maxSec, items }, state.settings.campaignMinFloorSec)
    if (problems.length) { errors.push(...problems.map(p => `${where}: ${p}`)); continue }

    const link = readLink(c.link, where, errors)
    campaigns.push({
      id: newId('camp'), name: title, audience, variants, vars, minSec, maxSec, link,
      moveToColumnId: moveTo?.id, status: 'draft', consecutiveFailures: 0, nextAt: 0,
      items, createdAt: now, updatedAt: now,
    })
    campaignLines.push(`${title}: ${items.length} contato(s), ${variants.length} variações, intervalo de ${minSec} a ${maxSec}s. Entra como rascunho.`)
    campaignLines.push(`  Exemplo: ${renderTemplate(variants[0], { contactName: items[0].name, vars }).text}`)
    if (link) campaignLines.push(`  ${describeLink(link)}`)
  }

  // ── Agendamentos ────────────────────────────────────────────────────────────
  const schedules: ScheduledMessage[] = []
  const scheduleLines: string[] = []
  for (const [i, a] of list('agendamentos').entries()) {
    const who = text(a.nome)
    const where = `Agendamento ${i + 1}${who ? ` (${who})` : ''}`
    const phone = normalizePhone(text(a.telefone))
    const message = text(a.mensagem)
    const scheduledAt = parseWhen(text(a.quando))
    const recurrence = RECURRENCE[key(text(a.repetir) || 'nao')]
    if (!who) errors.push(`${where}: falta o nome.`)
    if (!phone) errors.push(`${where}: telefone inválido. Use DDD + número.`)
    if (!message) errors.push(`${where}: falta a mensagem.`)
    if (scheduledAt === null) errors.push(`${where}: "quando" precisa ser AAAA-MM-DD HH:MM.`)
    if (!recurrence) errors.push(`${where}: "repetir" deve ser nao, diario, semanal ou mensal.`)
    if (!who || !phone || !message || scheduledAt === null || !recurrence) continue
    // Repetido é conferido antes da data, para o mesmo código poder ser colado de novo.
    const repeated = [...state.schedules, ...schedules].some(m =>
      phoneKey(m.phone) === phoneKey(phone) && m.message === message && (m.scheduledAt === scheduledAt || (recurrence !== 'none' && m.recurrence === recurrence)))
    if (repeated) { skipped.push(`Agendamento para ${who} já existe.`); continue }
    if (scheduledAt <= now) { errors.push(`${where}: a data ${formatWhen(scheduledAt)} já passou.`); continue }
    const vars: Record<string, string> = {}
    if (isObj(a.variaveis)) for (const [k, v] of Object.entries(a.variaveis)) vars[k] = String(v)
    const preview = renderTemplate(message, { contactName: who, vars, now: new Date(scheduledAt) })
    if (preview.missing.length) { errors.push(`${where}: preencha ${preview.missing.map(v => `{${v}}`).join(', ')}.`); continue }
    const autoSend = a.enviarSozinho === true
    const link = readLink(a.link, where, errors)
    schedules.push({
      id: newId('msg'), contactName: who, phone, message, vars, autoSend, scheduledAt, recurrence, link,
      status: 'pending', attempts: 0, createdAt: now, updatedAt: now,
    })
    const repeat = recurrence === 'none' ? '' : `, repete ${text(a.repetir)}`
    scheduleLines.push(`${formatWhen(scheduledAt)}${repeat} → ${who} (${formatPhone(phone)}) · ${autoSend ? 'ENVIA SOZINHA' : 'pede sua confirmação'}`)
    scheduleLines.push(`  ${preview.text}`)
    if (link) scheduleLines.push(`  ${describeLink(link)}`)
  }
  const automatic = schedules.filter(s => s.autoSend).length
  if (automatic) warnings.push(`${automatic} mensagem(ns) agendada(s) serão enviadas SOZINHAS, sem pedir confirmação.`)

  // ── Respostas rápidas ───────────────────────────────────────────────────────
  const templates = [...state.templates]
  const templateLines: string[] = []
  for (const [i, r] of list('respostasRapidas').entries()) {
    const title = text(r.titulo)
    const body = text(r.texto)
    if (!title || !body) { errors.push(`Resposta rápida ${i + 1}: falta título ou texto.`); continue }
    if (templates.some(t => key(t.title) === key(title))) { skipped.push(`Resposta rápida "${title}" já existe.`); continue }
    templates.push({ id: newId('tpl'), title, body })
    templateLines.push(`${title}: ${body}`)
  }

  // ── Tarefas ─────────────────────────────────────────────────────────────────
  const tasks: Task[] = []
  const taskLines: string[] = []
  for (const [i, t] of list('tarefas').entries()) {
    const title = text(t.titulo)
    const where = `Tarefa ${title ? `"${title}"` : i + 1}`
    const dueAt = parseWhen(text(t.quando))
    if (!title || dueAt === null) { errors.push(`${where}: precisa de "titulo" e "quando" (AAAA-MM-DD HH:MM).`); continue }
    const phone = text(t.telefone) ? normalizePhone(text(t.telefone)) : undefined
    if (phone === null) { errors.push(`${where}: telefone inválido.`); continue }
    if ([...state.tasks, ...tasks].some(x => key(x.title) === key(title) && x.dueAt === dueAt)) { skipped.push(`${where} já existe.`); continue }
    if (dueAt <= now) { errors.push(`${where}: a data ${formatWhen(dueAt)} já passou.`); continue }
    tasks.push({ id: newId('task'), title, dueAt, phone, contactName: text(t.nome) || undefined, done: false, createdAt: now })
    taskLines.push(`${formatWhen(dueAt)} → ${title}`)
  }

  // ── Pausa por lote ──────────────────────────────────────────────────────────
  let settings: Partial<AppSettings> | null = null
  const settingLines: string[] = []
  if (data.pausa !== undefined) {
    const p = isObj(data.pausa) ? data.pausa : {}
    const every = Number(p.aCada)
    const min = Number(p.minMin)
    const max = Number(p.maxMin)
    if (![every, min, max].every(Number.isInteger) || every < 1 || min < 1 || max < min) {
      errors.push('"pausa" precisa de "aCada", "minMin" e "maxMin" (números inteiros, a partir de 1).')
    } else if (every !== state.settings.batchSize || min !== state.settings.batchPauseMinMin || max !== state.settings.batchPauseMaxMin) {
      settings = { batchSize: every, batchPauseMinMin: min, batchPauseMaxMin: max }
      settingLines.push(`Pausa de ${min} a ${max} min a cada ${every} envios (hoje: ${state.settings.batchPauseMinMin} a ${state.settings.batchPauseMaxMin} min a cada ${state.settings.batchSize}).`)
    }
  }

  if (errors.length) return { ok: false, errors }

  const sections = [
    { title: 'Quadros e etapas', lines: boardLines },
    { title: 'Contatos', lines: contactLines },
    { title: 'Campanhas', lines: campaignLines },
    { title: 'Mensagens agendadas', lines: scheduleLines },
    { title: 'Respostas rápidas', lines: templateLines },
    { title: 'Tarefas', lines: taskLines },
    { title: 'Pausa entre envios', lines: settingLines },
  ].filter(s => s.lines.length)

  const pick = <T,>(source: Record<string, T>, ids: Set<string>) => Object.fromEntries([...ids].map(i => [i, source[i]]))
  const total = boardLines.length + contactLines.length + campaigns.length + schedules.length + templateLines.length + tasks.length + settingLines.length

  return {
    ok: true, id, name, sections, warnings, skipped, total,
    changes: {
      boards: boardsChanged ? boards : null,
      columns: pick(columns, changedColumns),
      cards: pick(cards, changedCards),
      campaigns,
      schedules,
      templates: templateLines.length ? templates : null,
      tasks,
      settings,
    },
  }
}
