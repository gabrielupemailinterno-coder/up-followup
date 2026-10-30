/**
 * Background Service Worker
 * Alarmes, notificações e orquestração dos envios (agendamentos e campanhas).
 *
 * Envio: o background abre o chat pelo número e a página do WhatsApp (SendBanner)
 * executa o envio. Com `auto` ele sai sozinho; sem `auto` o usuário confirma.
 * Todo estado vive no chrome.storage: o service worker pode ser encerrado a qualquer momento.
 */

import {
  ensureSchema,
  getScheduledMessages,
  getScheduledMessage,
  saveScheduledMessage,
  patchScheduledMessage,
  deleteScheduledMessage,
  getSettings,
  getTodayLog,
  registerSend,
  getActiveSend,
  setActiveSend,
  appendSendEvent,
  getCampaigns,
  getCampaign,
  saveCampaign,
  getTasks,
  saveTask,
  deleteTask,
  getKanbanCards,
  saveAllKanbanCards,
  applyColumnChange,
  getSendHistory,
  getCrmJobs,
  getCrmLeads,
  saveCrmJob,
  patchCrmJob,
  saveAllCrmJobs,
  getCrmDriverTab,
  setCrmDriverTab,
} from '../src/storage'
import {
  buildActivityComment, isDuplicate, makeDedupeKey, matchLeadByPhone, pickActivityType,
} from '../src/crm'
import { renderTemplate } from '../src/templates'
import { nextMorning, pickVariantIndex, randomDelayMs } from '../src/campaign'
import type {
  ActiveSend, BackgroundMessage, Campaign, CrmJob, Recurrence, Reply, ScheduledMessage, Task,
} from '../src/types'

const ALARM_PREFIX = 'wm_msg_'
const NOTIFY_PREFIX = 'wm_notify_'
const TASK_PREFIX = 'wm_task_'
const TICK_ALARM = 'wm_tick'
const ACTIVE_SEND_TTL_MS = 3 * 60 * 1000
const AUTO_TOLERANCE_MS = 5 * 60 * 1000   // além disso o agendamento vira "vencido" e espera decisão

// ─── Install / Startup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(details => {
  void bootstrap(false)
  // Primeira instalação: abre o manual do time.
  if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('manual/index.html#primeiros-passos') })
})
chrome.runtime.onStartup.addListener(() => { void bootstrap(true) })

async function bootstrap(browserRestarted: boolean) {
  await ensureSchema()
  await resyncAlarms()
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 })

  if (browserRestarted) {
    // Registros no CRM interrompidos no meio: não repete sozinho (evita duplicar a atividade).
    await setCrmDriverTab(null)
    for (const j of await getCrmJobs()) {
      if (j.status === 'running') {
        await patchCrmJob(j.id, { status: 'failed', message: 'Interrompido (navegador reiniciado). Confira no CRM e tente de novo.' })
      }
    }
    // Nada sai sozinho depois de o computador/navegador ficar parado: campanhas voltam pausadas.
    await setActiveSend(null)
    for (const c of await getCampaigns()) {
      if (c.status === 'running') {
        await saveCampaign({ ...c, status: 'paused', pauseReason: 'Navegador reiniciado. Retome quando quiser.' })
      }
    }
    const overdue = await getOverdue()
    if (overdue.length > 0) {
      notify('overdue_summary', 'WhatsApp Web Mod ⏰',
        `${overdue.length} follow-up(s) venceram com o navegador fechado. Abra a extensão para enviar, reagendar ou pular.`)
    }
  }
  await updateBadge()
}

async function getOverdue(): Promise<ScheduledMessage[]> {
  const now = Date.now()
  return (await getScheduledMessages()).filter(m => m.status === 'pending' && m.scheduledAt <= now)
}

async function getOverdueTasks(): Promise<Task[]> {
  const now = Date.now()
  return (await getTasks()).filter(t => !t.done && t.dueAt <= now)
}

async function updateBadge() {
  const n = (await getOverdue()).length + (await getOverdueTasks()).length
  await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' })
  await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void updateBadge()
})

// ─── Alarmes ──────────────────────────────────────────────────────────────────

async function scheduleAlarm(msg: ScheduledMessage) {
  if (msg.status !== 'pending') return
  const now = Date.now()
  const { notifyBeforeMinutes } = await getSettings()
  const notifyAt = msg.scheduledAt - notifyBeforeMinutes * 60_000

  if (notifyBeforeMinutes > 0 && notifyAt > now) {
    chrome.alarms.create(`${NOTIFY_PREFIX}${msg.id}`, { when: notifyAt })
  }
  // Alarme no passado dispararia na hora; vencidos são tratados pelo popup/selo.
  if (msg.scheduledAt > now) {
    chrome.alarms.create(`${ALARM_PREFIX}${msg.id}`, { when: msg.scheduledAt })
  }
}

function scheduleTaskAlarm(task: Task) {
  if (!task.done && task.dueAt > Date.now()) {
    chrome.alarms.create(`${TASK_PREFIX}${task.id}`, { when: task.dueAt })
  }
}

async function clearAlarms(id: string) {
  await chrome.alarms.clear(`${ALARM_PREFIX}${id}`)
  await chrome.alarms.clear(`${NOTIFY_PREFIX}${id}`)
}

/** Recria todos os alarmes a partir do storage (após import, atualização ou reinício). */
async function resyncAlarms() {
  const all = await chrome.alarms.getAll()
  await Promise.all(
    all
      .filter(a => [ALARM_PREFIX, NOTIFY_PREFIX, TASK_PREFIX].some(p => a.name.startsWith(p)))
      .map(a => chrome.alarms.clear(a.name))
  )
  for (const msg of await getScheduledMessages()) await scheduleAlarm(msg)
  for (const task of await getTasks()) scheduleTaskAlarm(task)
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === TICK_ALARM) {
    await recoverStaleSend()
    await tickCampaigns()
    await kickCrmDriver()
    await maybeCloseCrmDriver()
    await updateBadge()
    return
  }

  if (alarm.name.startsWith(NOTIFY_PREFIX)) {
    const msg = await getScheduledMessage(alarm.name.slice(NOTIFY_PREFIX.length))
    if (msg && msg.status === 'pending') {
      const mins = Math.max(1, Math.round((msg.scheduledAt - Date.now()) / 60_000))
      notify(`soon_${msg.id}`, 'WhatsApp Web Mod 📅',
        `Follow-up para "${msg.contactName}" em ~${mins} min${msg.autoSend ? ' (sai sozinho)' : ''}.`)
    }
    return
  }

  if (alarm.name.startsWith(TASK_PREFIX)) {
    const task = (await getTasks()).find(t => t.id === alarm.name.slice(TASK_PREFIX.length))
    if (task && !task.done) {
      chrome.notifications.create(`task_${task.id}`, {
        type: 'basic',
        iconUrl: 'assets/icon128.png',
        title: 'WhatsApp Web Mod ✅ Tarefa',
        message: task.contactName ? `${task.title} (${task.contactName})` : task.title,
        requireInteraction: true,
      })
      await updateBadge()
    }
    return
  }

  if (alarm.name.startsWith(ALARM_PREFIX)) {
    const msg = await getScheduledMessage(alarm.name.slice(ALARM_PREFIX.length))
    if (!msg || msg.status !== 'pending') return

    const late = Date.now() - msg.scheduledAt
    if (msg.autoSend && late <= AUTO_TOLERANCE_MS) {
      const reply = await requestSend(msg.id)
      if (!reply.ok) await onAutoSendBlocked(msg, reply)
      return
    }
    // Sem envio automático (ou atrasado demais): avisa e espera o usuário.
    chrome.notifications.create(`due_${msg.id}`, {
      type: 'basic',
      iconUrl: 'assets/icon128.png',
      title: 'WhatsApp Web Mod ⏰ Hora do follow-up',
      message: `Enviar para "${msg.contactName}". Clique para abrir o chat e confirmar.`,
      requireInteraction: true,
      buttons: [{ title: 'Abrir e confirmar' }],
    })
    await updateBadge()
  }
})

/** Envio automático que não pôde sair agora: adia se for transitório, senão avisa. */
async function onAutoSendBlocked(msg: ScheduledMessage, reply: { code: string; message: string }) {
  if (reply.code === 'BUSY' || reply.code === 'MIN_INTERVAL') {
    const waitMs = reply.code === 'MIN_INTERVAL' ? Number(reply.message.match(/\d+/)?.[0] ?? 30) * 1000 : 30_000
    chrome.alarms.create(`${ALARM_PREFIX}${msg.id}`, { when: Date.now() + Math.max(waitMs, 30_000) + 2000 })
    return
  }
  notify(`blocked_${msg.id}`, 'WhatsApp Web Mod ⚠️', `Follow-up para "${msg.contactName}" não saiu: ${reply.message}`)
  await updateBadge()
}

chrome.notifications.onClicked.addListener(id => { void onNotificationAction(id) })
chrome.notifications.onButtonClicked.addListener(id => { void onNotificationAction(id) })

async function onNotificationAction(notificationId: string) {
  if (!notificationId.startsWith('due_')) return
  chrome.notifications.clear(notificationId)
  await requestSend(notificationId.slice('due_'.length))
}

function notify(id: string, title: string, message: string) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'assets/icon128.png', title, message })
}

// ─── Envio (agendamentos) ─────────────────────────────────────────────────────

function fail(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message }
}

async function getFreshActiveSend(): Promise<ActiveSend | null> {
  const job = await getActiveSend()
  if (!job) return null
  if (Date.now() - job.startedAt > ACTIVE_SEND_TTL_MS) return null
  return job
}

/** Valida limites e variáveis, e abre o chat pelo número com o texto preenchido. */
async function requestSend(id: string): Promise<Reply> {
  const msg = await getScheduledMessage(id)
  if (!msg) return fail('NOT_FOUND', 'Agendamento não encontrado.')
  if (msg.status !== 'pending') return fail('NOT_PENDING', 'Este agendamento não está pendente.')
  if (!msg.phone) return fail('NO_PHONE', 'Agendamento sem telefone. Reagende informando o número.')

  const { text, missing } = renderTemplate(msg.message, { contactName: msg.contactName, vars: msg.vars })
  if (missing.length > 0) {
    return fail('MISSING_VARS', `Variáveis sem valor: ${missing.map(v => `{${v}}`).join(', ')}.`)
  }

  if (await getFreshActiveSend()) return fail('BUSY', 'Há outro envio em andamento. Tentando de novo em instantes.')

  const [settings, log] = await Promise.all([getSettings(), getTodayLog()])
  if (log.count >= settings.dailyLimit) {
    const reply = fail('DAILY_LIMIT', `Limite diário atingido (${log.count}/${settings.dailyLimit}). Tente amanhã ou ajuste em Configurações.`)
    notify('limit', 'WhatsApp Web Mod 🛑', reply.message)
    return reply
  }
  const waitMs = log.lastSentAt + settings.minIntervalSec * 1000 - Date.now()
  if (waitMs > 0) {
    return fail('MIN_INTERVAL', `Aguarde ${Math.ceil(waitMs / 1000)}s desde o último envio antes de enviar outro.`)
  }

  await setActiveSend({
    id: msg.id, phone: msg.phone, contactName: msg.contactName, text,
    startedAt: Date.now(), auto: msg.autoSend, source: 'schedule',
  })
  await patchScheduledMessage(msg.id, { attempts: msg.attempts + 1 })
  await openWhatsApp(`https://web.whatsapp.com/send?phone=${msg.phone}&text=${encodeURIComponent(text)}`, msg.autoSend)
  return { ok: true }
}

/**
 * Abre/navega a aba do WhatsApp Web. Envios automáticos não roubam o foco
 * (não interrompem o que você está fazendo); com confirmação manual a aba vem para a frente.
 */
async function openWhatsApp(url: string, background = false) {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  const tab = tabs[0]
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { url, active: !background })
    if (!background && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url, active: !background, pinned: background })
  }
}

async function recoverStaleSend() {
  const job = await getActiveSend()
  if (!job || Date.now() - job.startedAt <= ACTIVE_SEND_TTL_MS) return
  await setActiveSend(null)
  // A página nunca respondeu (aba fechada/WA travado): trata como falha.
  await finishSend(job, { ok: false, code: 'TIMEOUT', message: 'Sem resposta da página do WhatsApp Web (aba fechada ou travada).' })
}

type SendResult = { ok: boolean; code?: string; message?: string }

async function handleSendResult(p: SendResult & { id: string }): Promise<Reply> {
  const job = await getActiveSend()
  if (!job || job.id !== p.id) return fail('NO_ACTIVE_SEND', 'Nenhum envio em andamento para este agendamento.')
  await setActiveSend(null)
  const nextDelayMs = await finishSend(job, p)
  return { ok: true, data: { nextDelayMs } }
}

/** Aplica o resultado de um envio. Retorna o atraso até o próximo item de campanha, se houver. */
async function finishSend(job: ActiveSend, p: SendResult): Promise<number | undefined> {
  if (job.source === 'campaign' && job.campaignId) return finishCampaignItem(job, p)

  const msg = await getScheduledMessage(job.id)
  if (!msg) return undefined

  if (p.ok) {
    await patchScheduledMessage(msg.id, { status: 'sent', failReason: undefined })
    await registerSend()
    await appendSendEvent(msg.phone, 'schedule')
    void enqueueCrmActivity({ phone: msg.phone, contactName: msg.contactName, text: job.text, source: 'schedule' })
    await scheduleNextOccurrence(msg)
    notify(`sent_${msg.id}`, 'WhatsApp Web Mod ✅', `Mensagem enviada para "${msg.contactName}".`)
  } else if (p.code === 'CANCELLED') {
    // Usuário desistiu na hora: continua pendente.
  } else {
    await patchScheduledMessage(msg.id, { status: 'failed', failReason: p.message ?? p.code ?? 'Falha no envio' })
    notify(`fail_${msg.id}`, 'WhatsApp Web Mod ❌',
      `Falha para "${msg.contactName}": ${p.message ?? 'erro desconhecido'}`)
  }
  return undefined
}

async function scheduleNextOccurrence(msg: ScheduledMessage) {
  if (msg.recurrence === 'none') return
  let next = nextOccurrence(msg.scheduledAt, msg.recurrence)
  while (next <= Date.now()) next = nextOccurrence(next, msg.recurrence)
  const now = Date.now()
  const created: ScheduledMessage = {
    ...msg,
    id: `msg_${now}_${Math.random().toString(36).slice(2)}`,
    scheduledAt: next,
    status: 'pending',
    failReason: undefined,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }
  await saveScheduledMessage(created)
  await scheduleAlarm(created)
}

function nextOccurrence(from: number, recurrence: Recurrence): number {
  const d = new Date(from)
  if (recurrence === 'daily') d.setDate(d.getDate() + 1)
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7)
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

// ─── Campanhas ────────────────────────────────────────────────────────────────

const RESTRICTION_CODE = 'RESTRICTED'

async function startCampaign(id: string): Promise<Reply> {
  const c = await getCampaign(id)
  if (!c) return fail('NOT_FOUND', 'Campanha não encontrada.')
  if (c.status === 'running') return { ok: true }
  if (!c.items.some(i => i.status === 'pending')) return fail('EMPTY', 'Não há contatos pendentes nesta campanha.')
  await saveCampaign({ ...c, status: 'running', pauseReason: undefined, consecutiveFailures: 0, nextAt: Date.now() })
  return advanceCampaign(id)
}

async function setCampaignStatus(id: string, status: Campaign['status'], reason?: string): Promise<Reply> {
  const c = await getCampaign(id)
  if (!c) return fail('NOT_FOUND', 'Campanha não encontrada.')
  await saveCampaign({ ...c, status, pauseReason: reason })
  return { ok: true }
}

/** Idempotente: só avança se estiver rodando, sem envio em andamento e já na hora. */
async function advanceCampaign(id: string): Promise<Reply> {
  const c = await getCampaign(id)
  if (!c || c.status !== 'running') return { ok: true }
  if (Date.now() < c.nextAt - 1500) return { ok: true }
  if (await getFreshActiveSend()) return { ok: true }

  const idx = c.items.findIndex(i => i.status === 'pending')
  if (idx < 0) {
    await saveCampaign({ ...c, status: 'done', pauseReason: undefined })
    notify(`camp_done_${c.id}`, 'WhatsApp Web Mod ✅', `Campanha "${c.name}" concluída.`)
    return { ok: true }
  }

  const [settings, log] = await Promise.all([getSettings(), getTodayLog()])
  if (log.count >= settings.dailyLimit) {
    await saveCampaign({
      ...c, nextAt: nextMorning(),
      pauseReason: `Limite diário atingido (${log.count}/${settings.dailyLimit}). Retoma amanhã às 09:00.`,
    })
    notify(`camp_limit_${c.id}`, 'WhatsApp Web Mod 🛑', `Campanha "${c.name}" em pausa: limite diário atingido. Retoma amanhã às 09:00.`)
    return { ok: true }
  }

  const item = c.items[idx]
  const variantIdx = pickVariantIndex(c.variants.length)
  const { text, missing } = renderTemplate(c.variants[variantIdx], { contactName: item.name, vars: c.vars })
  if (missing.length > 0) {
    // Não deve ocorrer (validado na criação); trata como falha do item e segue.
    const items = c.items.map((it, i) => (i === idx ? { ...it, status: 'failed' as const, error: `Variáveis sem valor: ${missing.join(', ')}` } : it))
    await saveCampaign({ ...c, items, nextAt: Date.now() + 1000 })
    return advanceCampaign(id)
  }

  const items = c.items.map((it, i) => (i === idx ? { ...it, status: 'sending' as const, variantIdx, error: undefined } : it))
  await saveCampaign({ ...c, items, pauseReason: undefined })
  await setActiveSend({
    id: `${c.id}#${idx}`, phone: item.phone, contactName: item.name, text,
    startedAt: Date.now(), auto: true, source: 'campaign', campaignId: c.id,
  })
  await openWhatsApp(`https://web.whatsapp.com/send?phone=${item.phone}&text=${encodeURIComponent(text)}`, true)
  return { ok: true }
}

async function finishCampaignItem(job: ActiveSend, p: SendResult): Promise<number | undefined> {
  const c = await getCampaign(job.campaignId!)
  if (!c) return undefined
  const idx = Number(job.id.split('#')[1])

  if (p.code === 'CANCELLED') {
    // Cancelou o envio em andamento: o contato volta para a fila e a campanha pausa.
    await saveCampaign({
      ...c,
      status: 'paused',
      pauseReason: 'Envio cancelado por você.',
      items: c.items.map((it, i) => (i === idx ? { ...it, status: 'pending' as const } : it)),
    })
    return undefined
  }

  const items = c.items.map((it, i) => {
    if (i !== idx) return it
    return p.ok
      ? { ...it, status: 'sent' as const, sentAt: Date.now(), error: undefined }
      : { ...it, status: 'failed' as const, error: p.message ?? p.code ?? 'Falha no envio' }
  })

  if (p.ok) {
    await registerSend()
    await appendSendEvent(job.phone, 'campaign')
    void enqueueCrmActivity({ phone: job.phone, contactName: job.contactName, text: job.text, source: 'campaign' })
    if (c.moveToColumnId) await moveCardOfPhone(job.phone, c.moveToColumnId)
  }

  const settings = await getSettings()
  const consecutiveFailures = p.ok ? 0 : c.consecutiveFailures + 1
  let status: Campaign['status'] = c.status
  let pauseReason: string | undefined = c.pauseReason

  if (c.status === 'running') {
    if (p.code === RESTRICTION_CODE) {
      status = 'paused'
      pauseReason = 'O WhatsApp mostrou um aviso de restrição/bloqueio. Campanha pausada por segurança.'
    } else if (consecutiveFailures >= settings.maxConsecutiveFailures) {
      status = 'paused'
      pauseReason = `${consecutiveFailures} falhas seguidas (último erro: ${p.message ?? p.code ?? 'desconhecido'}).`
    } else if (!items.some(i => i.status === 'pending')) {
      status = 'done'
      pauseReason = undefined
    }
  }

  const delay = randomDelayMs(c.minSec, c.maxSec)
  await saveCampaign({ ...c, items, status, pauseReason, consecutiveFailures, nextAt: Date.now() + delay })

  if (status === 'paused') notify(`camp_pause_${c.id}`, 'WhatsApp Web Mod ⏸️', `Campanha "${c.name}" pausada: ${pauseReason}`)
  if (status === 'done') notify(`camp_done_${c.id}`, 'WhatsApp Web Mod ✅', `Campanha "${c.name}" concluída.`)
  return status === 'running' ? delay : undefined
}

async function moveCardOfPhone(phone: string, columnId: string) {
  const cards = await getKanbanCards()
  const card = cards.find(c => c.phone === phone)
  if (!card || card.columnId === columnId) return
  await saveAllKanbanCards(cards.map(c => (c.id === card.id ? applyColumnChange(c, columnId) : c)))
}

/** Rede de segurança: o content script normalmente avança no timer; aqui cobre aba fechada/timer atrasado. */
async function tickCampaigns() {
  if (await getFreshActiveSend()) return
  for (const c of await getCampaigns()) {
    if (c.status === 'running' && Date.now() >= c.nextAt) await advanceCampaign(c.id)
  }
}

// ─── CRM Incbook: fila de atividades ──────────────────────────────────────────

const CRM_URL = 'https://crm.incbook.com.br'
const CRM_IDLE_CLOSE_MS = 3 * 60_000

interface CrmJobInput {
  phone: string
  contactName: string
  activityType: string
  comment: string
  source: CrmJob['source']
}

/** Cria o job (com trava de duplicidade) e acorda a aba que opera o CRM. */
async function enqueueCrmJob(input: CrmJobInput): Promise<Reply> {
  const settings = await getSettings()
  const now = Date.now()
  const dedupeKey = makeDedupeKey(input.phone, input.activityType, input.comment, now)
  if (isDuplicate(await getCrmJobs(), dedupeKey)) return { ok: true, data: 'duplicate' }

  const match = matchLeadByPhone(await getCrmLeads(), input.phone)
  const job: CrmJob = {
    id: `crm_${now}_${Math.random().toString(36).slice(2)}`,
    phone: input.phone,
    contactName: input.contactName,
    activityType: input.activityType,
    comment: input.comment,
    dedupeKey,
    leadId: match.kind === 'one' ? match.lead.id : undefined,
    leadName: match.kind === 'one' ? match.lead.name : undefined,
    status: 'pending',
    dryRun: settings.crmDryRun,
    attempts: 0,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  }
  await saveCrmJob(job)
  await kickCrmDriver()
  return { ok: true }
}

/** Após um envio bem-sucedido: registra a atividade no CRM (se a função estiver ligada). */
async function enqueueCrmActivity(p: { phone: string; contactName: string; text: string; source: 'schedule' | 'campaign' }) {
  try {
    const settings = await getSettings()
    if (!settings.crmEnabled) return
    // o envio atual já está no histórico: anteriores = total - 1
    const prior = (await getSendHistory()).filter(e => e.phone === p.phone).length - 1
    await enqueueCrmJob({
      phone: p.phone,
      contactName: p.contactName,
      activityType: pickActivityType(prior, settings),
      comment: buildActivityComment(p.text),
      source: p.source,
    })
  } catch (err) {
    console.warn('[WM] falha ao enfileirar atividade do CRM', err)
  }
}

/** Garante uma aba do CRM, só da extensão (fixada, em segundo plano), enquanto houver job a fazer. */
async function kickCrmDriver() {
  const pending = (await getCrmJobs()).some(j => j.status === 'pending' || j.status === 'running')
  if (!pending) return
  const id = await getCrmDriverTab()
  if (id !== null) {
    try {
      const tab = await chrome.tabs.get(id)
      if (tab.url?.startsWith(CRM_URL)) return
    } catch { /* aba não existe mais */ }
  }
  const tab = await chrome.tabs.create({ url: `${CRM_URL}/leads`, active: false, pinned: true })
  if (tab.id !== undefined) await setCrmDriverTab(tab.id)
}

async function maybeCloseCrmDriver() {
  const id = await getCrmDriverTab()
  if (id === null) return
  const jobs = await getCrmJobs()
  const busy = jobs.some(j => j.status === 'pending' || j.status === 'running')
  const lastUpdate = jobs.reduce((m, j) => Math.max(m, j.updatedAt), 0)
  if (busy || Date.now() - lastUpdate < CRM_IDLE_CLOSE_MS) return
  try { await chrome.tabs.remove(id) } catch { /* já fechada */ }
  await setCrmDriverTab(null)
}

chrome.tabs.onRemoved.addListener(async tabId => {
  if ((await getCrmDriverTab()) === tabId) await setCrmDriverTab(null)
})

// ─── Mensagens (popup / kanban / content) ─────────────────────────────────────

async function handle(msg: BackgroundMessage, sender?: chrome.runtime.MessageSender): Promise<Reply> {
  switch (msg.type) {
    case 'SCHEDULE_MESSAGE': {
      await saveScheduledMessage(msg.payload)
      await scheduleAlarm(msg.payload)
      return { ok: true }
    }
    case 'CANCEL_SCHEDULE': {
      await clearAlarms(msg.payload.id)
      await deleteScheduledMessage(msg.payload.id)
      return { ok: true }
    }
    case 'SEND_NOW':
      return requestSend(msg.payload.id)
    case 'RESCHEDULE': {
      if (msg.payload.scheduledAt <= Date.now()) return fail('PAST', 'Escolha um horário no futuro.')
      await clearAlarms(msg.payload.id)
      const updated = await patchScheduledMessage(msg.payload.id, {
        scheduledAt: msg.payload.scheduledAt, status: 'pending', failReason: undefined,
      })
      if (!updated) return fail('NOT_FOUND', 'Agendamento não encontrado.')
      await scheduleAlarm(updated)
      return { ok: true }
    }
    case 'SKIP': {
      await clearAlarms(msg.payload.id)
      const m = await getScheduledMessage(msg.payload.id)
      if (!m) return fail('NOT_FOUND', 'Agendamento não encontrado.')
      await patchScheduledMessage(m.id, { status: 'skipped' })
      await scheduleNextOccurrence(m)
      return { ok: true }
    }
    case 'OPEN_CHAT':
      await openWhatsApp(`https://web.whatsapp.com/send?phone=${msg.payload.phone}`)
      return { ok: true }
    case 'OPEN_KANBAN': {
      const hash = msg.payload?.hash ? `#${msg.payload.hash}` : ''
      await chrome.tabs.create({ url: chrome.runtime.getURL('kanban/index.html') + hash })
      return { ok: true }
    }
    case 'OPEN_MANUAL': {
      const hash = msg.payload?.hash ? `#${msg.payload.hash}` : ''
      await chrome.tabs.create({ url: chrome.runtime.getURL('manual/index.html') + hash })
      return { ok: true }
    }
    case 'RESYNC_ALARMS':
      await resyncAlarms()
      await updateBadge()
      return { ok: true }
    case 'GET_ACTIVE_SEND': {
      const job = await getFreshActiveSend()
      return { ok: true, data: job }
    }
    case 'SEND_RESULT':
      return handleSendResult(msg.payload)

    case 'TASK_SAVE':
      await saveTask(msg.payload)
      await chrome.alarms.clear(`${TASK_PREFIX}${msg.payload.id}`)
      scheduleTaskAlarm(msg.payload)
      return { ok: true }
    case 'TASK_DONE': {
      const task = (await getTasks()).find(t => t.id === msg.payload.id)
      if (!task) return fail('NOT_FOUND', 'Tarefa não encontrada.')
      const updated: Task = { ...task, done: msg.payload.done, doneAt: msg.payload.done ? Date.now() : undefined }
      await saveTask(updated)
      await chrome.alarms.clear(`${TASK_PREFIX}${task.id}`)
      scheduleTaskAlarm(updated)
      return { ok: true }
    }
    case 'TASK_DELETE':
      await chrome.alarms.clear(`${TASK_PREFIX}${msg.payload.id}`)
      await deleteTask(msg.payload.id)
      return { ok: true }

    case 'CAMPAIGN_START':
      return startCampaign(msg.payload.id)
    case 'CAMPAIGN_PAUSE':
      return setCampaignStatus(msg.payload.id, 'paused', 'Pausada por você.')
    case 'CAMPAIGN_RESUME': {
      const c = await getCampaign(msg.payload.id)
      if (!c) return fail('NOT_FOUND', 'Campanha não encontrada.')
      await saveCampaign({ ...c, status: 'running', pauseReason: undefined, consecutiveFailures: 0, nextAt: Date.now() })
      return advanceCampaign(c.id)
    }
    case 'CAMPAIGN_STOP':
      return setCampaignStatus(msg.payload.id, 'stopped', 'Interrompida por você.')
    case 'CAMPAIGN_ADVANCE':
      return advanceCampaign(msg.payload.id)

    case 'CRM_WHO_AM_I': {
      const id = await getCrmDriverTab()
      return { ok: true, data: { driver: id !== null && sender?.tab?.id === id } }
    }
    case 'CRM_ENQUEUE':
      return enqueueCrmJob({ ...msg.payload, source: 'manual' })
    case 'CRM_RETRY': {
      const settings = await getSettings()
      const job = await patchCrmJob(msg.payload.id, { status: 'pending', attempts: 0, message: undefined, dryRun: settings.crmDryRun })
      if (!job) return fail('NOT_FOUND', 'Registro não encontrado.')
      await kickCrmDriver()
      return { ok: true }
    }
    case 'CRM_DISCARD':
      await saveAllCrmJobs((await getCrmJobs()).filter(j => j.id !== msg.payload.id))
      return { ok: true }
    case 'CRM_KICK':
      await kickCrmDriver()
      return { ok: true }
  }
}

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch(err => sendResponse(fail('INTERNAL', String(err))))
  return true
})
