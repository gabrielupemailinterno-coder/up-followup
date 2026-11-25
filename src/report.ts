/**
 * Relatório que a extensão entrega ao Claude: o que existe e como está andando.
 * Não leva telefones.
 */

import { getAppliedPlans, getTodayLog } from './storage'
import { loadPlanState } from './planStore'
import { downloadFile } from './backup'
import { campaignProgress } from './campaign'
import { realName } from './templates'

/** Apaga qualquer número de telefone que esteja no meio de um texto livre. */
export function scrubPhones(value: string): string {
  // 9 dígitos ou mais: não confunde com "2026-2027".
  return value.replace(/\+?\d[\d\s().-]{6,}\d/g, m => (m.replace(/\D/g, '').length >= 9 ? '[número]' : m))
}

const personName = (n: string) => scrubPhones(realName(n)) || 'sem nome'
const clip = (s: string, max = 160) => scrubPhones(s).slice(0, max)

function localDate(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export async function buildReport(now = Date.now()) {
  const [s, applied, log] = await Promise.all([loadPlanState(), getAppliedPlans(), getTodayLog()])
  const columnName = new Map(Object.values(s.columns).flat().map(c => [c.id, c.title]))

  return {
    app: 'evler-relatorio',
    geradoEm: localDate(now),
    versao: chrome.runtime.getManifest().version,
    enviosHoje: log.count,
    pausa: { aCada: s.settings.batchSize, minMin: s.settings.batchPauseMinMin, maxMin: s.settings.batchPauseMaxMin },
    codigosAplicados: applied.slice(-30).map(a => ({ id: a.id, nome: clip(a.name), aplicadoEm: localDate(a.appliedAt), resumo: a.summary })),
    quadros: s.boards.map(b => {
      const cards = s.cards[b.id] ?? []
      const tags: Record<string, number> = {}
      for (const c of cards) for (const t of c.tags) tags[scrubPhones(t)] = (tags[scrubPhones(t)] ?? 0) + 1
      return {
        nome: clip(b.name),
        etapas: [...(s.columns[b.id] ?? [])].sort((x, y) => x.order - y.order)
          .map(col => ({ nome: clip(col.title), contatos: cards.filter(c => c.columnId === col.id).length })),
        tags,
      }
    }),
    campanhas: s.campaigns.map(c => {
      const p = campaignProgress(c)
      return {
        nome: clip(c.name), situacao: c.status, criadaEm: localDate(c.createdAt),
        total: p.total, enviadas: p.sent, falhas: p.failed, pendentes: p.pending,
        motivoPausa: c.pauseReason ? clip(c.pauseReason) : undefined,
        temImagem: Boolean(c.imageId),
        link: c.link?.style,
        moverPara: c.moveToColumnId ? columnName.get(c.moveToColumnId) : undefined,
      }
    }),
    agendamentos: [...s.schedules].sort((a, b) => b.scheduledAt - a.scheduledAt).slice(0, 200).map(m => ({
      nome: personName(m.contactName), quando: localDate(m.scheduledAt), situacao: m.status,
      temImagem: Boolean(m.imageId), link: m.link?.style, enviarSozinho: m.autoSend, repetir: m.recurrence, mensagem: clip(m.message),
      motivoFalha: m.failReason ? clip(m.failReason) : undefined,
    })),
    tarefas: s.tasks.slice(-200).map(t => ({
      titulo: clip(t.title), quando: localDate(t.dueAt), feita: t.done,
      nome: t.contactName ? personName(t.contactName) : undefined,
    })),
    respostasRapidas: s.templates.map(t => clip(t.title)),
  }
}

/** Salva o relatório em Downloads, onde a skill /extensao vai buscar. Devolve o nome do arquivo. */
export async function downloadReport(): Promise<string> {
  const report = await buildReport()
  const stamp = report.geradoEm.replace(/[-:]/g, '').replace(' ', '-')
  const filename = `evler-relatorio-${stamp}.json`
  downloadFile(filename, JSON.stringify(report, null, 2), 'application/json')
  return filename
}
