// ─── Shared Types ─────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 3

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'
export type ScheduleStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface ScheduledMessage {
  id: string
  contactName: string
  phone: string            // E.164 sem "+", ex.: 5531999999999
  message: string          // texto bruto, com variáveis {nome}, {data}…
  vars: Record<string, string>   // valores das variáveis extras
  templateId?: string
  autoSend: boolean        // true = envia sozinho; false = pede confirmação no banner
  scheduledAt: number      // Unix timestamp (ms)
  recurrence: Recurrence
  status: ScheduleStatus
  failReason?: string
  attempts: number
  createdAt: number
  updatedAt: number
}

export interface ColumnChange {
  columnId: string
  at: number
}

export interface KanbanCard {
  id: string
  contactName: string
  phone: string            // E.164 sem "+"; chave única (vazio só em cards legados)
  columnId: string
  columnChangedAt: number
  columnHistory: ColumnChange[]
  tags: string[]
  notes: string
  lastMessage: string
  lastMessageAt: number
  order: number
  createdAt: number
  updatedAt: number
}

export interface KanbanColumn {
  id: string
  title: string
  description?: string     // o que significa estar nesta etapa (aparece sob o título)
  color: string
  order: number
  createdAt: number
}

export interface Template {
  id: string
  title: string
  body: string
}

export interface Task {
  id: string
  title: string
  dueAt: number
  phone?: string
  contactName?: string
  done: boolean
  createdAt: number
  doneAt?: number
}

export interface AppSettings {
  notifyBeforeMinutes: number   // 0 = sem aviso prévio
  dailyLimit: number            // máximo de envios por dia nesta conta
  minIntervalSec: number        // intervalo mínimo entre envios agendados
  maxConsecutiveFailures: number   // campanha pausa após N falhas seguidas
  campaignMinFloorSec: number   // piso do intervalo mínimo de uma campanha
  crmEnabled: boolean           // registrar atividade no CRM Incbook após cada envio
  crmDryRun: boolean            // modo teste: preenche o formulário mas NÃO envia
  crmFirstType: string          // tipo de atividade da 1ª mensagem ao lead
  crmFollowupType: string       // tipo de atividade dos envios seguintes
}

export interface SendLog {
  date: string                  // YYYY-MM-DD (horário local)
  count: number
  lastSentAt: number
}

export type SendSource = 'schedule' | 'campaign' | 'manual'

export interface SendEvent {
  ts: number
  phone: string
  source: SendSource
}

export interface ActiveSend {
  id: string                    // id do agendamento, ou `${campaignId}#${itemIdx}`
  phone: string
  contactName: string
  text: string                  // texto já renderizado
  startedAt: number
  auto: boolean                 // true = envia sem pedir clique
  source: 'schedule' | 'campaign'
  campaignId?: string
}

// ─── Campanhas ────────────────────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'stopped' | 'done'
export type CampaignItemStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface CampaignItem {
  phone: string
  name: string
  status: CampaignItemStatus
  variantIdx?: number
  error?: string
  sentAt?: number
}

export type CampaignAudience =
  | { kind: 'kanban'; columnId?: string; tag?: string }
  | { kind: 'pasted' }
  | { kind: 'both'; columnId?: string; tag?: string }

export interface Campaign {
  id: string
  name: string
  audience: CampaignAudience
  variants: string[]            // mínimo 5
  vars: Record<string, string>  // valores das variáveis extras (iguais p/ todos)
  minSec: number
  maxSec: number
  moveToColumnId?: string
  status: CampaignStatus
  pauseReason?: string
  consecutiveFailures: number
  nextAt: number                // quando o próximo envio pode sair
  items: CampaignItem[]
  createdAt: number
  updatedAt: number
}

// ─── CRM Incbook ──────────────────────────────────────────────────────────────

export interface CrmStageInfo {
  order: number
  enteredAt: number            // entrada na etapa
  lastInteractionAt: number    // última interação do dono do lead
  owner?: string
}

export interface CrmLead {
  id: string
  name: string
  phones: string[]             // E.164 sem "+"
  empreendimentos: string[]
  stage?: CrmStageInfo
  syncedAt: number
}

export type CrmJobStatus = 'pending' | 'running' | 'done' | 'tested' | 'failed' | 'skipped'

export interface CrmJob {
  id: string
  phone: string
  contactName: string
  activityType: string         // texto exato da opção do CRM, ex.: "1 - Tentativa de contato"
  comment: string
  dedupeKey: string
  leadId?: string
  leadName?: string
  status: CrmJobStatus
  dryRun: boolean
  message?: string
  attempts: number
  source: 'schedule' | 'campaign' | 'manual'
  createdAt: number
  updatedAt: number
}

/** Resultado da última tentativa de enfileirar uma atividade do CRM (para explicar o que aconteceu). */
export interface CrmDiag {
  at: number
  phone: string
  result: 'disabled' | 'queued' | 'duplicate' | 'error'
  detail?: string
}

export interface BackupFile {
  app: 'whatsapp-web-mod'
  schemaVersion: number
  exportedAt: number
  columns: KanbanColumn[]
  cards: KanbanCard[]
  schedules: ScheduledMessage[]
  templates: Template[]
  settings: AppSettings
  campaigns?: Campaign[]
  tasks?: Task[]
  history?: SendEvent[]
}

// ─── Mensageria ───────────────────────────────────────────────────────────────

export type BackgroundMessage =
  | { type: 'SCHEDULE_MESSAGE'; payload: ScheduledMessage }
  | { type: 'CANCEL_SCHEDULE'; payload: { id: string } }
  | { type: 'SEND_NOW'; payload: { id: string } }
  | { type: 'RESCHEDULE'; payload: { id: string; scheduledAt: number } }
  | { type: 'SKIP'; payload: { id: string } }
  | { type: 'OPEN_CHAT'; payload: { phone: string } }
  | { type: 'OPEN_KANBAN'; payload?: { hash?: string } }
  | { type: 'OPEN_MANUAL'; payload?: { hash?: string } }
  | { type: 'RESYNC_ALARMS' }
  | { type: 'GET_ACTIVE_SEND' }
  | { type: 'SEND_RESULT'; payload: { id: string; ok: boolean; code?: string; message?: string } }
  | { type: 'TASK_SAVE'; payload: Task }
  | { type: 'TASK_DONE'; payload: { id: string; done: boolean } }
  | { type: 'TASK_DELETE'; payload: { id: string } }
  | { type: 'CAMPAIGN_START'; payload: { id: string } }
  | { type: 'CAMPAIGN_PAUSE'; payload: { id: string } }
  | { type: 'CAMPAIGN_RESUME'; payload: { id: string } }
  | { type: 'CAMPAIGN_STOP'; payload: { id: string } }
  | { type: 'CAMPAIGN_ADVANCE'; payload: { id: string } }
  | { type: 'CRM_WHO_AM_I' }
  | { type: 'CRM_ENQUEUE'; payload: { phone: string; contactName: string; activityType: string; comment: string } }
  | { type: 'CRM_RETRY'; payload: { id: string } }
  | { type: 'CRM_DISCARD'; payload: { id: string } }
  | { type: 'CRM_KICK' }
  | { type: 'WPP_STATUS' }

export type Reply<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; code: string; message: string }

export function sendToBackground<T = unknown>(msg: BackgroundMessage): Promise<Reply<T>> {
  return chrome.runtime.sendMessage(msg) as Promise<Reply<T>>
}
