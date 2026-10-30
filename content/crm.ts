/**
 * Content script do CRM Incbook (crm.incbook.com.br).
 *  1) Leitor (em qualquer aba do CRM): lê leads de /leads e /funil e atualiza o índice local.
 *     Só leitura; nunca toca em credenciais.
 *  2) Executor (somente na aba "driver" aberta pela extensão): registra as atividades pendentes,
 *     como uma pessoa faria, em modo teste ou de verdade conforme a configuração.
 */

import type { CrmJob, CrmLead } from '../src/types'
import { sendToBackground } from '../src/types'
import { getCrmJobs, getSettings, mergeCrmLeads, patchCrmJob } from '../src/storage'
import { runJobStep } from '../src/crmDriver'
import { createCrmAdapter, leadsFromFunilPage, leadsFromLeadsPage, sleep } from './crm-adapter'

const MAX_PAGE_LOADS_PER_JOB = 6
const RUNNING_TIMEOUT_MS = 4 * 60_000

// ─── Leitor ───────────────────────────────────────────────────────────────────

function startReader() {
  // Leve de propósito: só lê com a aba visível, a cada 8 s, e grava no storage no máximo a cada 30 s.
  let enabled = false
  const refreshEnabled = () => { void getSettings().then(st => { enabled = st.crmEnabled }) }
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

  setInterval(() => { tick(); flush() }, 8000)
}

// ─── Executor ─────────────────────────────────────────────────────────────────

async function runDriver() {
  const adapter = createCrmAdapter()
  await sleep(2500) // dá tempo da página do CRM terminar de montar

  for (;;) {
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

    let result
    try {
      result = await runJobStep(job, adapter)
    } catch (err) {
      await patchCrmJob(job.id, { status: 'failed', message: `Erro inesperado: ${String(err)}` })
      continue
    }

    if (result.kind === 'navigating') {
      if (result.patch) await patchCrmJob(job.id, result.patch)
      return // a página vai recarregar; o script reinicia e retoma o job
    }

    await patchCrmJob(job.id, { status: result.status, message: result.message, ...result.patch })
    await sleep(4000 + Math.random() * 5000) // pausa humana entre atividades
  }
}

// ─── Início ───────────────────────────────────────────────────────────────────

startReader()
void sendToBackground<{ driver: boolean }>({ type: 'CRM_WHO_AM_I' }).then(r => {
  if (r.ok && r.data?.driver) void runDriver()
})
