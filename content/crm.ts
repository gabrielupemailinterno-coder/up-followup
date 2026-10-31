/**
 * Content script do CRM Incbook (crm.incbook.com.br).
 *  1) Leitor (em qualquer aba do CRM): lê leads de /leads e /funil e atualiza o índice local.
 *     Só leitura; nunca toca em credenciais.
 *  2) Executor (somente na aba "driver" aberta pela extensão): registra as atividades pendentes,
 *     como uma pessoa faria, em modo teste ou de verdade conforme a configuração.
 */

import type { CrmJob, CrmLead } from '../src/types'
import { sendToBackground } from '../src/types'
import { appendCrmTrace, getCrmJobs, getSettings, mergeCrmLeads, patchCrmJob } from '../src/storage'
import { runJobStep } from '../src/crmDriver'
import { createCrmAdapter, describeCrmPage, leadsFromFunilPage, leadsFromLeadsPage, sleep, waitFor } from './crm-adapter'
import { extensionAlive, safeInterval } from '../src/alive'

const MAX_PAGE_LOADS_PER_JOB = 6
const RUNNING_TIMEOUT_MS = 4 * 60_000
const STEP_TIMEOUT_MS = 90_000   // nenhum passo pode passar disso: vira falha com o nome do passo

// ─── Leitor ───────────────────────────────────────────────────────────────────

function startReader() {
  // Leve de propósito: só lê com a aba visível, a cada 8 s, e grava no storage no máximo a cada 30 s.
  let enabled = false
  const refreshEnabled = () => { void getSettings().then(st => { enabled = st.crmEnabled }).catch(() => {}) }
  refreshEnabled()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'wm_settings' in changes) refreshEnabled()
  })

  let lastSig = ''
  let lastFlush = 0
  const pending = new Map<string, CrmLead>()

  const tick = () => {
    if (!enabled || document.hidden) return
    const path = location.pathname
    if (!path.startsWith('/leads') && !path.startsWith('/funil')) return
    const leads = path.startsWith('/leads') ? leadsFromLeadsPage() : leadsFromFunilPage()
    if (leads.length === 0) return
    const sig = leads.map(l => `${l.id}:${l.stage?.lastInteractionAt ?? ''}`).join(',')
    if (sig === lastSig) return
    lastSig = sig
    for (const l of leads) pending.set(l.id, l)
  }

  const flush = () => {
    if (pending.size === 0 || Date.now() - lastFlush < 30_000) return
    const batch = [...pending.values()]
    pending.clear()
    lastFlush = Date.now()
    void mergeCrmLeads(batch)
  }

  safeInterval(() => { tick(); flush() }, 8000)
}

// ─── Executor ─────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: () => string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tempo esgotado (${Math.round(ms / 1000)} s) em: ${label()}`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Aviso visível na aba de trabalho: mostra em que passo está e onde parou. */
function banner(text: string | null) {
  let el = document.getElementById('wm-driver-banner')
  if (text === null) { el?.remove(); return }
  if (!el) {
    el = document.createElement('div')
    el.id = 'wm-driver-banner'
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:440px;padding:8px 12px;border-radius:10px;' +
      'background:#3A4A3F;color:#F7F4ED;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none'
    document.body.appendChild(el)
  }
  el.textContent = `Follow-up UP · ${text}`
}

async function runDriver() {
  const adapter = createCrmAdapter()
  await sleep(2500) // dá tempo da página do CRM terminar de montar

  while (extensionAlive()) {
    const jobs = await getCrmJobs()
    let job: CrmJob | undefined = jobs.find(j => j.status === 'running') ?? jobs.find(j => j.status === 'pending')
    if (!job) {
      await sleep(3000)
      continue
    }

    // Trava contra job preso ou navegação em loop
    if (job.status === 'running' && Date.now() - job.updatedAt > RUNNING_TIMEOUT_MS) {
      await patchCrmJob(job.id, { status: 'failed', message: 'Tempo esgotado ao registrar no CRM.' })
      continue
    }
    if (job.attempts >= MAX_PAGE_LOADS_PER_JOB) {
      await patchCrmJob(job.id, { status: 'failed', message: 'Muitas tentativas sem concluir. Confira o CRM.' })
      continue
    }
    job = (await patchCrmJob(job.id, { status: 'running', attempts: job.attempts + 1 })) ?? job
    const jobId = job.id
    let lastStep = 'iniciando'
    const note = (text: string, asMessage: boolean) => {
      lastStep = text
      banner(text)
      void appendCrmTrace(jobId, text, asMessage).catch(() => {})
    }
    note(`passo ${job.attempts}: ${describeCrmPage()}`, false)

    let result
    try {
      result = await withTimeout(runJobStep(job, adapter, text => note(text, true)), STEP_TIMEOUT_MS, () => lastStep)
    } catch (err) {
      const msg = `Travou: ${err instanceof Error ? err.message : String(err)}. ${describeCrmPage()}`
      note(msg, false)
      await patchCrmJob(jobId, { status: 'failed', message: msg })
      continue
    }

    if (result.kind === 'navigating') {
      // 1) grava o que descobrimos (ex.: o id do lead) ANTES de sair da página: senão ele se perde no recarregamento
      if (result.patch) await patchCrmJob(jobId, result.patch)
      note(`indo para ${result.to}${result.patch?.leadId ? ' (lead encontrado)' : ''}`, true)
      // 2) navega e espera a tela mudar; com navegação interna o script continua vivo e segue no laço
      adapter.goto(result.to)
      const arrived = await waitFor(() => location.pathname.replace(/\/+$/, '') === result.to, 10_000, 200)
      if (!arrived) {
        const msg = `Não consegui abrir a tela ${result.to} do CRM (ficou em ${location.pathname}). ${describeCrmPage()}`
        note(msg, false)
        await patchCrmJob(jobId, { status: 'failed', message: msg })
        continue
      }
      note(`chegou em ${location.pathname}`, false)
      await sleep(2000) // deixa a tela nova montar
      continue
    }

    note(`resultado: ${result.status}. ${result.message}${result.status === 'failed' ? ` · ${describeCrmPage()}` : ''}`, false)
    await patchCrmJob(jobId, { status: result.status, message: result.message, ...result.patch })
    if (result.status !== 'failed') setTimeout(() => banner(null), 8000) // em falha o aviso fica para você ver
    await sleep(4000 + Math.random() * 5000) // pausa humana entre atividades
  }
}

// ─── Início ───────────────────────────────────────────────────────────────────

startReader()
void sendToBackground<{ driver: boolean }>({ type: 'CRM_WHO_AM_I' })
  .then(r => {
    if (r.ok && r.data?.driver) void runDriver().catch(() => { /* extensão recarregada: este script é órfão */ })
  })
  .catch(() => {})
