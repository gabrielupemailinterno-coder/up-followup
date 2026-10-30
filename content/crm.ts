/**
 * Content script do CRM Incbook (crm.incbook.com.br).
 *  1) Leitor (em qualquer aba do CRM): lê leads de /leads e /funil e atualiza o índice local.
 *     Só leitura; nunca toca em credenciais.
 *  2) Executor (somente na aba "driver" aberta pela extensão): registra as atividades pendentes,
 *     como uma pessoa faria, em modo teste ou de verdade conforme a configuração.
 */

import type { CrmJob } from '../src/types'
import { sendToBackground } from '../src/types'
import { getCrmJobs, getSettings, mergeCrmLeads, patchCrmJob } from '../src/storage'
import { runJobStep } from '../src/crmDriver'
import { createCrmAdapter, leadsFromFunilPage, leadsFromLeadsPage, sleep } from './crm-adapter'

const MAX_PAGE_LOADS_PER_JOB = 6
const RUNNING_TIMEOUT_MS = 4 * 60_000

// ─── Leitor ───────────────────────────────────────────────────────────────────

function startReader() {
  let lastSig = ''
  const tick = async () => {
    // Só guarda leads se a função de CRM estiver ligada em Configurações.
    if (!(await getSettings()).crmEnabled) return
    const path = location.pathname
    const leads = path.startsWith('/leads') ? leadsFromLeadsPage() : path.startsWith('/funil') ? leadsFromFunilPage() : []
    const sig = leads.map(l => `${l.id}:${l.stage?.lastInteractionAt ?? ''}`).join(',')
    if (leads.length > 0 && sig !== lastSig) {
      lastSig = sig
      void mergeCrmLeads(leads)
    }
  }
  void tick()
  setInterval(() => { void tick() }, 4000)
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
