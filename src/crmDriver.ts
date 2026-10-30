/**
 * Executor de atividade no CRM Incbook, "como uma pessoa faria", em passos.
 * Não toca no DOM: fala com o CRM por um adaptador (content/crm-adapter.ts), o que permite testar
 * toda a lógica de segurança sem abrir o CRM.
 *
 * Fluxo (a navegação recarrega a página, então o estado fica no próprio job):
 *   /leads  : busca o telefone formatado e descobre o id do lead (exatamente 1 resultado)
 *   /funil  : abre o card pelo id, CONFERE o telefone no painel, preenche e (fora do modo teste) envia
 */

import type { CrmJob } from './types'
import { CRM_PAGE_SIZE, formatPhoneForCrm, phoneSearchQueries, samePhone } from './crm'

export interface LeadHit {
  id: string
  name: string
  phones: string[]
}

export interface CrmPageAdapter {
  path(): string
  /** Navegação completa; o script é reiniciado na página seguinte e o job continua. */
  goto(path: string): void
  /** Digita `query` na busca do CRM e devolve os leads listados (até uma página). */
  searchLeadsByPhone(query: string): Promise<LeadHit[]>
  openLeadCard(leadId: string, leadName: string): Promise<boolean>
  readModalPhones(): string[]
  openActivityForm(): Promise<boolean>
  selectActivityType(label: string): Promise<{ ok: boolean; available?: string[] }>
  selectWhenNow(): Promise<boolean>
  writeComment(text: string): Promise<boolean>
  activityCount(): number | null
  submit(): Promise<boolean>
  waitForNewActivity(before: number | null): Promise<boolean>
  closeModal(): Promise<void>
}

export type StepResult =
  | { kind: 'navigating'; patch?: Partial<CrmJob> }
  | { kind: 'finished'; status: 'done' | 'tested' | 'failed' | 'skipped'; message: string; patch?: Partial<CrmJob> }

const fail = (message: string): StepResult => ({ kind: 'finished', status: 'failed', message })

export async function runJobStep(job: CrmJob, page: CrmPageAdapter): Promise<StepResult> {
  // 1) Descobrir o lead pelo telefone, se ainda não sabemos
  if (!job.leadId) {
    if (page.path() !== '/leads') {
      page.goto('/leads')
      return { kind: 'navigating' }
    }
    const queries = phoneSearchQueries(job.phone)
    if (queries.length === 0) return fail('Telefone fora do formato brasileiro: não dá para buscar no CRM.')
    const shown = formatPhoneForCrm(job.phone) ?? job.phone

    // Busca pelos 4 últimos dígitos (tolerante ao formato) e CONFERE o telefone completo nos resultados.
    // Só considera o resultado confiável se a lista não vier truncada (página cheia).
    let matching: LeadHit[] = []
    let reliable = false
    for (const q of queries) {
      const hits = await page.searchLeadsByPhone(q)
      matching = hits.filter(h => h.phones.some(p => samePhone(p, job.phone)))
      reliable = hits.length < CRM_PAGE_SIZE
      if (reliable) break
    }
    if (matching.length === 0) return fail(`Lead não encontrado no CRM com o telefone ${shown}.`)
    if (matching.length > 1) {
      return { kind: 'finished', status: 'skipped', message: `Há ${matching.length} leads com o telefone ${shown}. Registre manualmente para não errar o lead.` }
    }
    if (!reliable) {
      return { kind: 'finished', status: 'skipped', message: `A busca do CRM por ${shown} devolveu muitos resultados e não dá para garantir que o lead é único. Registre manualmente.` }
    }
    page.goto('/funil')
    return { kind: 'navigating', patch: { leadId: matching[0].id, leadName: matching[0].name } }
  }

  // 2) Abrir o card no funil
  if (page.path() !== '/funil') {
    page.goto('/funil')
    return { kind: 'navigating' }
  }
  const opened = await page.openLeadCard(job.leadId, job.leadName ?? '')
  if (!opened) return fail('Não achei o card deste lead no funil (pode ser de outro corretor ou estar fora do filtro).')

  // 3) Trava anti-lead-errado: o telefone do painel aberto tem que bater
  const phones = page.readModalPhones()
  if (!phones.some(p => samePhone(p, job.phone))) {
    await page.closeModal()
    return fail('O telefone do lead aberto não confere com o da conversa. Nada foi registrado.')
  }

  // 4) Preencher o formulário
  if (!(await page.openActivityForm())) {
    await page.closeModal()
    return fail('O formulário "Adicionar Atividade" não abriu.')
  }
  const type = await page.selectActivityType(job.activityType)
  if (!type.ok) {
    await page.closeModal()
    const list = type.available?.length ? ` Tipos disponíveis: ${type.available.join(' | ')}.` : ''
    return fail(`O tipo "${job.activityType}" não existe no CRM.${list}`)
  }
  await page.selectWhenNow()
  if (!(await page.writeComment(job.comment))) {
    await page.closeModal()
    return fail('Não consegui preencher o comentário da atividade.')
  }

  // 5) Modo teste: para antes de enviar
  if (job.dryRun) {
    await page.closeModal()
    return { kind: 'finished', status: 'tested', message: `Modo teste: formulário preenchido (${job.activityType}) e NÃO enviado.` }
  }

  // 6) Enviar e confirmar
  const before = page.activityCount()
  if (!(await page.submit())) {
    await page.closeModal()
    return fail('Não consegui clicar em "Adicionar Atividade".')
  }
  const confirmed = await page.waitForNewActivity(before)
  await page.closeModal()
  if (!confirmed) {
    return fail('Enviei o formulário, mas não consegui confirmar a atividade no histórico. Confira no CRM antes de tentar de novo, para não duplicar.')
  }
  return { kind: 'finished', status: 'done', message: 'Atividade registrada no CRM.' }
}
