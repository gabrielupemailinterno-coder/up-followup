import type {
  ScheduledMessage, KanbanCard, KanbanColumn, AppSettings, Template, SendLog, ActiveSend,
  Campaign, Task, SendEvent, SendSource, CrmLead, CrmJob,
} from './types'
import { SCHEMA_VERSION } from './types'
import { DEFAULT_TEMPLATES } from './templates'

// ─── Default Data ──────────────────────────────────────────────────────────────

/** Funil padrão de pré-atendimento (nomes alinhados às etapas iniciais do funil UP - Comercial Geral no CRM). */
export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'col-1', title: 'Novo lead', description: 'Entrou agora e ainda não recebeu contato.', color: '#7B896F', order: 0, createdAt: 0 },
  { id: 'col-2', title: 'Tentativa de contato', description: 'Primeira mensagem enviada; aguardando resposta.', color: '#56788A', order: 1, createdAt: 0 },
  { id: 'col-3', title: 'Em qualificação', description: 'Respondeu. Entendendo interesse, prazo e perfil.', color: '#4E8A86', order: 2, createdAt: 0 },
  { id: 'col-4', title: 'Diagnóstico', description: 'Renda, entrada e objetivo levantados; definindo o produto ideal.', color: '#8C6A8F', order: 3, createdAt: 0 },
  { id: 'col-5', title: 'Visita / Reunião agendada', description: 'Visita ou reunião marcada com o corretor.', color: '#B08A3E', order: 4, createdAt: 0 },
  { id: 'col-6', title: 'Follow-up qualificado', description: 'Qualificado, aguardando o momento certo. Retomar com follow-up.', color: '#3F6B4B', order: 5, createdAt: 0 },
  { id: 'col-7', title: 'Perdido', description: 'Sem interesse, sem resposta após a cadência ou fora do perfil.', color: '#A5432F', order: 6, createdAt: 0 },
]

export const DEFAULT_SETTINGS: AppSettings = {
  notifyBeforeMinutes: 5,
  dailyLimit: 30,
  minIntervalSec: 60,
  maxConsecutiveFailures: 3,
  campaignMinFloorSec: 15,
  crmEnabled: false,
  crmDryRun: true,
  crmFirstType: '1 - Tentativa de contato',
  crmFollowupType: '4B - Follow-up realizado',
}

// ─── Storage Keys ──────────────────────────────────────────────────────────────

const KEYS = {
  SCHEDULED: 'wm_scheduled_messages',
  KANBAN_CARDS: 'wm_kanban_cards',
  KANBAN_COLUMNS: 'wm_kanban_columns',
  TEMPLATES: 'wm_templates',
  SETTINGS: 'wm_settings',
  SEND_LOG: 'wm_send_log',
  ACTIVE_SEND: 'wm_active_send',
  SCHEMA: 'wm_schema_version',
  CAMPAIGNS: 'wm_campaigns',
  TASKS: 'wm_tasks',
  HISTORY: 'wm_send_history',
  CRM_LEADS: 'wm_crm_leads',
  CRM_JOBS: 'wm_crm_jobs',
  CRM_DRIVER_TAB: 'wm_crm_driver_tab',
}

// ─── Generic helpers ───────────────────────────────────────────────────────────

async function get<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key)
  return result[key] !== undefined ? result[key] : fallback
}

async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

// ─── Migração ──────────────────────────────────────────────────────────────────

/** Normaliza dados vindos do MVP (contactId) ou de backups antigos. */
export function migrateSchedules(list: ScheduledMessage[]): ScheduledMessage[] {
  return list.map(m => {
    const legacy = m as ScheduledMessage & { contactId?: string }
    const phone = legacy.phone ?? ''
    const withoutPhone = !phone && legacy.status === 'pending'
    return {
      ...m,
      phone,
      vars: m.vars ?? {},
      autoSend: m.autoSend ?? true,
      attempts: m.attempts ?? 0,
      status: withoutPhone ? 'failed' : m.status,
      failReason: withoutPhone ? 'Sem telefone (agendamento antigo). Reagende informando o número.' : m.failReason,
    }
  })
}

export function migrateCards(list: KanbanCard[]): KanbanCard[] {
  return list.map(c => {
    const created = c.createdAt ?? Date.now()
    return {
      ...c,
      phone: c.phone ?? '',
      tags: c.tags ?? [],
      notes: c.notes ?? '',
      columnChangedAt: c.columnChangedAt ?? c.updatedAt ?? created,
      columnHistory: c.columnHistory ?? [{ columnId: c.columnId, at: created }],
    }
  })
}

export async function ensureSchema(): Promise<void> {
  const version = await get<number>(KEYS.SCHEMA, 0)
  if (version >= SCHEMA_VERSION) return
  await set(KEYS.SCHEDULED, migrateSchedules(await get<ScheduledMessage[]>(KEYS.SCHEDULED, [])))
  await set(KEYS.KANBAN_CARDS, migrateCards(await get<KanbanCard[]>(KEYS.KANBAN_CARDS, [])))
  await set(KEYS.SCHEMA, SCHEMA_VERSION)
}

// ─── Scheduled Messages ────────────────────────────────────────────────────────

export async function getScheduledMessages(): Promise<ScheduledMessage[]> {
  return get<ScheduledMessage[]>(KEYS.SCHEDULED, [])
}

export async function saveAllScheduledMessages(list: ScheduledMessage[]): Promise<void> {
  await set(KEYS.SCHEDULED, list)
}

export async function getScheduledMessage(id: string): Promise<ScheduledMessage | undefined> {
  return (await getScheduledMessages()).find(m => m.id === id)
}

export async function saveScheduledMessage(msg: ScheduledMessage): Promise<void> {
  const all = await getScheduledMessages()
  const idx = all.findIndex(m => m.id === msg.id)
  if (idx >= 0) all[idx] = msg
  else all.push(msg)
  await set(KEYS.SCHEDULED, all)
}

export async function deleteScheduledMessage(id: string): Promise<void> {
  const all = await getScheduledMessages()
  await set(KEYS.SCHEDULED, all.filter(m => m.id !== id))
}

export async function patchScheduledMessage(
  id: string,
  patch: Partial<ScheduledMessage>
): Promise<ScheduledMessage | undefined> {
  const all = await getScheduledMessages()
  const idx = all.findIndex(m => m.id === id)
  if (idx < 0) return undefined
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() }
  await set(KEYS.SCHEDULED, all)
  return all[idx]
}

// ─── Kanban Cards ──────────────────────────────────────────────────────────────

export async function getKanbanCards(): Promise<KanbanCard[]> {
  return get<KanbanCard[]>(KEYS.KANBAN_CARDS, [])
}

export async function saveKanbanCard(card: KanbanCard): Promise<void> {
  const all = await getKanbanCards()
  const idx = all.findIndex(c => c.id === card.id)
  if (idx >= 0) all[idx] = card
  else all.push(card)
  await set(KEYS.KANBAN_CARDS, all)
}

export async function deleteKanbanCard(id: string): Promise<void> {
  const all = await getKanbanCards()
  await set(KEYS.KANBAN_CARDS, all.filter(c => c.id !== id))
}

export async function saveAllKanbanCards(cards: KanbanCard[]): Promise<void> {
  await set(KEYS.KANBAN_CARDS, cards)
}

// ─── Kanban Columns ────────────────────────────────────────────────────────────

export async function getKanbanColumns(): Promise<KanbanColumn[]> {
  return get<KanbanColumn[]>(KEYS.KANBAN_COLUMNS, DEFAULT_COLUMNS)
}

export async function saveKanbanColumns(columns: KanbanColumn[]): Promise<void> {
  await set(KEYS.KANBAN_COLUMNS, columns)
}

// ─── Templates ─────────────────────────────────────────────────────────────────

export async function getTemplates(): Promise<Template[]> {
  return get<Template[]>(KEYS.TEMPLATES, DEFAULT_TEMPLATES)
}

export async function saveTemplates(templates: Template[]): Promise<void> {
  await set(KEYS.TEMPLATES, templates)
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  const stored = await get<Partial<AppSettings>>(KEYS.SETTINGS, {})
  return { ...DEFAULT_SETTINGS, ...stored }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await set(KEYS.SETTINGS, settings)
}

// ─── Send log (limite diário) ──────────────────────────────────────────────────

export function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export async function getTodayLog(): Promise<SendLog> {
  const log = await get<SendLog | null>(KEYS.SEND_LOG, null)
  const today = todayKey()
  if (!log || log.date !== today) {
    return { date: today, count: 0, lastSentAt: log?.lastSentAt ?? 0 }
  }
  return log
}

export async function registerSend(): Promise<SendLog> {
  const log = await getTodayLog()
  const next: SendLog = { ...log, count: log.count + 1, lastSentAt: Date.now() }
  await set(KEYS.SEND_LOG, next)
  return next
}

// ─── Envio em andamento ────────────────────────────────────────────────────────

export async function getActiveSend(): Promise<ActiveSend | null> {
  return get<ActiveSend | null>(KEYS.ACTIVE_SEND, null)
}

export async function setActiveSend(job: ActiveSend | null): Promise<void> {
  if (job) await set(KEYS.ACTIVE_SEND, job)
  else await chrome.storage.local.remove(KEYS.ACTIVE_SEND)
}

// ─── Mudança de coluna (histórico para métricas) ───────────────────────────────

export function applyColumnChange(card: KanbanCard, columnId: string, now = Date.now()): KanbanCard {
  if (card.columnId === columnId) return card
  return {
    ...card,
    columnId,
    columnChangedAt: now,
    columnHistory: [...card.columnHistory, { columnId, at: now }].slice(-50),
    updatedAt: now,
  }
}

// ─── Campanhas ─────────────────────────────────────────────────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  return get<Campaign[]>(KEYS.CAMPAIGNS, [])
}

export async function saveAllCampaigns(list: Campaign[]): Promise<void> {
  await set(KEYS.CAMPAIGNS, list)
}

export async function getCampaign(id: string): Promise<Campaign | undefined> {
  return (await getCampaigns()).find(c => c.id === id)
}

export async function saveCampaign(campaign: Campaign): Promise<void> {
  const all = await getCampaigns()
  const idx = all.findIndex(c => c.id === campaign.id)
  const next = { ...campaign, updatedAt: Date.now() }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  await set(KEYS.CAMPAIGNS, all)
}

export async function deleteCampaign(id: string): Promise<void> {
  await set(KEYS.CAMPAIGNS, (await getCampaigns()).filter(c => c.id !== id))
}

// ─── Tarefas ───────────────────────────────────────────────────────────────────

export async function getTasks(): Promise<Task[]> {
  return get<Task[]>(KEYS.TASKS, [])
}

export async function saveAllTasks(list: Task[]): Promise<void> {
  await set(KEYS.TASKS, list)
}

export async function saveTask(task: Task): Promise<void> {
  const all = await getTasks()
  const idx = all.findIndex(t => t.id === task.id)
  if (idx >= 0) all[idx] = task
  else all.push(task)
  await set(KEYS.TASKS, all)
}

export async function deleteTask(id: string): Promise<void> {
  await set(KEYS.TASKS, (await getTasks()).filter(t => t.id !== id))
}

// ─── Histórico de envios (métricas) ────────────────────────────────────────────

const HISTORY_CAP = 5000

export async function getSendHistory(): Promise<SendEvent[]> {
  return get<SendEvent[]>(KEYS.HISTORY, [])
}

export async function saveAllSendHistory(list: SendEvent[]): Promise<void> {
  await set(KEYS.HISTORY, list.slice(-HISTORY_CAP))
}

export async function appendSendEvent(phone: string, source: SendSource): Promise<void> {
  const all = await getSendHistory()
  all.push({ ts: Date.now(), phone, source })
  await set(KEYS.HISTORY, all.slice(-HISTORY_CAP))
}

// ─── CRM Incbook ───────────────────────────────────────────────────────────────

export async function getCrmLeads(): Promise<CrmLead[]> {
  return get<CrmLead[]>(KEYS.CRM_LEADS, [])
}

/** Mescla leads lidos do CRM (por id), mantendo os campos que a página atual não trouxe. */
export async function mergeCrmLeads(incoming: CrmLead[]): Promise<void> {
  if (incoming.length === 0) return
  const byId = new Map((await getCrmLeads()).map(l => [l.id, l]))
  for (const l of incoming) {
    const old = byId.get(l.id)
    byId.set(l.id, {
      ...old,
      ...l,
      phones: l.phones.length ? l.phones : old?.phones ?? [],
      empreendimentos: l.empreendimentos.length ? l.empreendimentos : old?.empreendimentos ?? [],
      stage: l.stage ?? old?.stage,
    })
  }
  const all = [...byId.values()].sort((a, b) => b.syncedAt - a.syncedAt).slice(0, 5000)
  await set(KEYS.CRM_LEADS, all)
}

export async function getCrmJobs(): Promise<CrmJob[]> {
  return get<CrmJob[]>(KEYS.CRM_JOBS, [])
}

export async function saveAllCrmJobs(list: CrmJob[]): Promise<void> {
  await set(KEYS.CRM_JOBS, list.slice(-500))
}

export async function saveCrmJob(job: CrmJob): Promise<void> {
  const all = await getCrmJobs()
  const idx = all.findIndex(j => j.id === job.id)
  const next = { ...job, updatedAt: Date.now() }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  await saveAllCrmJobs(all)
}

export async function patchCrmJob(id: string, patch: Partial<CrmJob>): Promise<CrmJob | undefined> {
  const all = await getCrmJobs()
  const idx = all.findIndex(j => j.id === id)
  if (idx < 0) return undefined
  all[idx] = { ...all[idx], ...patch, updatedAt: Date.now() }
  await saveAllCrmJobs(all)
  return all[idx]
}

export async function getCrmDriverTab(): Promise<number | null> {
  return get<number | null>(KEYS.CRM_DRIVER_TAB, null)
}

export async function setCrmDriverTab(id: number | null): Promise<void> {
  if (id === null) await chrome.storage.local.remove(KEYS.CRM_DRIVER_TAB)
  else await set(KEYS.CRM_DRIVER_TAB, id)
}

export const STORAGE_KEYS = KEYS
