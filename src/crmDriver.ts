/**
 * Executor de atividade no CRM Incbook, "como uma pessoa faria", em passos.
 * Não toca no DOM: fala com o CRM por um adaptador (content/crm-adapter.ts), o que permite testar
 * toda a lógica de segurança sem abrir o CRM.
 *
 * Fluxo (tudo na tela /leads, sem recarregar):
 *   busca os 4 últimos dígitos do telefone, abre o lead clicando no nome, CONFERE o telefone no painel,
 *   preenche a atividade e (fora do modo teste) envia.
 */

import type { CrmJob } from './types'
import { CRM_PAGE_SIZE, formatPhoneForCrm, phoneSearchQueries, resolveActivityType, samePhone, type LeadHistory } from './crm'

/** Quantas linhas da busca estamos dispostos a abrir e conferir, uma a uma. */
export const MAX_ROW_CANDIDATES = 15   // buscar "1707" no CRM real devolve 6 leads: a lista não traz o telefone, então abrimos cada um

export interface CrmPageAdapter {
  path(): string
  /** Navegação para outra tela do CRM (preferir o link do menu). */
  goto(path: string): void
  /** Digita `query` na busca da tela Leads e devolve quantas linhas a lista mostra depois de atualizar. */
  searchLeadRows(query: string): Promise<number>
  /** Telefones lidos de cada linha visível da tabela (vazio se a tabela não mostra telefone). */
  rowPhones?(): string[][]
  /** Vai para a próxima página da lista; false se não houver. */
  nextPage?(): Promise<boolean>
  /** Clica no nome do lead da linha `index` e espera o painel abrir. */
  openLeadRow(index: number): Promise<boolean>
  readModalPhones(): string[]
  /** Muda o seletor "Etapa" do lead aberto. Em modo teste só confere a opção e cancela. */
  selectStage?(label: string, dryRun: boolean): Promise<{ ok: boolean; message: string }>
  /** Atividades e etapa do lead aberto (para decidir tentativa x follow-up). */
  leadHistory?(): LeadHistory
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
  /** Precisa trocar de tela. Quem chama grava `patch` PRIMEIRO e só então navega para `to`. */
  | { kind: 'navigating'; to: string; patch?: Partial<CrmJob> }
  | { kind: 'finished'; status: 'done' | 'tested' | 'failed' | 'skipped'; message: string; patch?: Partial<CrmJob> }

const fail = (message: string): StepResult => ({ kind: 'finished', status: 'failed', message })

/** Acha o lead pelo telefone na tela Leads e deixa o painel dele aberto (telefone conferido). */
async function openLeadByPhone(job: CrmJob, page: CrmPageAdapter, onStep: (text: string) => void): Promise<StepResult | 'opened'> {
  // 1) Ir para a tela Leads
  if (page.path() !== '/leads') return { kind: 'navigating', to: '/leads' }

  // 2) Buscar pelo final do telefone e abrir o lead que confere
  onStep('Buscando o lead no CRM…')
  const queries = phoneSearchQueries(job.phone)
  if (queries.length === 0) return fail('Telefone fora do formato brasileiro: não dá para buscar no CRM.')
  const shown = formatPhoneForCrm(job.phone) ?? job.phone

  let sawRows = false
  let openFailed = false
  let tooMany = false
  let opened = false
  for (const q of queries) {
    const rows = await page.searchLeadRows(q)
    if (rows === 0) continue
    sawRows = true

    // A tabela mostra o telefone: acha a linha pelo número (todas as páginas) e só então abre.
    let phones = page.rowPhones?.() ?? []
    if (phones.some(p => p.length > 0)) {
      for (let pg = 0; pg < 20; pg++) {
        const hits = phones.map((ps, i) => (ps.some(p => samePhone(p, job.phone)) ? i : -1)).filter(i => i >= 0)
        if (hits.length > 1) return { kind: 'finished', status: 'skipped', message: `Há ${hits.length} leads com o telefone ${shown}. Registre manualmente para não errar o lead.` }
        if (hits.length === 1) {
          onStep('Abrindo o lead (clicando no nome)…')
          if (await page.openLeadRow(hits[0])) {
            if (page.readModalPhones().length === 0 || page.readModalPhones().some(p => samePhone(p, job.phone))) { opened = true; break }
            await page.closeModal()
          } else openFailed = true
          break
        }
        if (!page.nextPage || !(await page.nextPage())) break
        phones = page.rowPhones?.() ?? []
      }
      if (opened) break
      continue
    }

    if (rows >= CRM_PAGE_SIZE || rows > MAX_ROW_CANDIDATES) { tooMany = true; continue }   // consulta mais específica na próxima

    if (rows === 1) {
      onStep('Abrindo o lead (clicando no nome)…')
      if (!(await page.openLeadRow(0))) { openFailed = true; continue }
      if (page.readModalPhones().some(p => samePhone(p, job.phone))) { opened = true; break }
      await page.closeModal()
      continue
    }

    // Várias linhas: abre cada uma e confere o telefone no painel. Dois leads com o mesmo telefone = ambíguo.
    const matches: number[] = []
    for (let i = 0; i < rows; i++) {
      onStep(`Conferindo o lead ${i + 1} de ${rows}…`)
      if (!(await page.openLeadRow(i))) { openFailed = true; continue }
      if (page.readModalPhones().some(p => samePhone(p, job.phone))) matches.push(i)
      await page.closeModal()
    }
    if (matches.length > 1) {
      return { kind: 'finished', status: 'skipped', message: `Há ${matches.length} leads com o telefone ${shown}. Registre manualmente para não errar o lead.` }
    }
    if (matches.length === 1) {
      if (!(await page.openLeadRow(matches[0]))) { openFailed = true; continue }
      if (page.readModalPhones().some(p => samePhone(p, job.phone))) { opened = true; break }
      await page.closeModal()
    }
  }

  if (!opened) {
    if (openFailed) return fail('Achei linhas na busca, mas não consegui abrir o lead clicando no nome. Veja o rastro na aba CRM.')
    if (tooMany && !sawRows) return fail('A busca devolveu muitos resultados. Registre manualmente.')
    if (!sawRows) return fail(`Nenhum lead encontrado na busca (telefone ${shown}, ${queries.length} formas). Confira se o lead existe, se é seu e qual telefone está cadastrado.`)
    return fail(`Nenhum dos leads encontrados tem o telefone ${shown} no cadastro. Nada foi registrado.`)
  }
  return 'opened'
}

/** Mudar a etapa do lead no CRM (Kanban → CRM). Modo teste: só confere que a etapa existe. */
export async function runStageStep(job: CrmJob, page: CrmPageAdapter, onStep: (text: string) => void = () => {}): Promise<StepResult> {
  const target = job.targetStage?.trim()
  if (!target) return fail('Etapa de destino não informada.')
  if (!page.selectStage) return fail('Esta versão não sabe mudar a etapa no CRM.')
  const opened = await openLeadByPhone(job, page, onStep)
  if (opened !== 'opened') return opened
  onStep(`Mudando a etapa para "${target}"…`)
  const r = await page.selectStage(target, job.dryRun)
  await page.closeModal()
  if (!r.ok) return fail(r.message)
  if (job.dryRun) return { kind: 'finished', status: 'tested', message: `Modo teste: a etapa "${target}" existe e NÃO foi alterada.` }
  return { kind: 'finished', status: 'done', message: r.message }
}

export async function runJobStep(
  job: CrmJob,
  page: CrmPageAdapter,
  onStep: (text: string) => void = () => {}
): Promise<StepResult> {
  const opened = await openLeadByPhone(job, page, onStep)
  if (opened !== 'opened') return opened

  // 4) Tipo da atividade conforme o histórico do lead no CRM, depois preencher o formulário
  const activityType = resolveActivityType(job, page.leadHistory?.() ?? { activities: null, stage: null })
  const patch = activityType !== job.activityType ? { activityType } : undefined
  if (patch) onStep(`Tipo ajustado pelo histórico do lead: ${activityType}`)
  onStep('Preenchendo a atividade…')
  if (!(await page.openActivityForm())) {
    await page.closeModal()
    return fail('O formulário "Adicionar Atividade" não abriu.')
  }
  const type = await page.selectActivityType(activityType)
  if (!type.ok) {
    await page.closeModal()
    const list = type.available?.length ? ` Tipos disponíveis: ${type.available.join(' | ')}.` : ''
    return fail(`O tipo "${activityType}" não existe no CRM.${list}`)
  }
  await page.selectWhenNow()
  if (!(await page.writeComment(job.comment))) {
    await page.closeModal()
    return fail('Não consegui preencher o comentário da atividade.')
  }

  // 5) Modo teste: para antes de enviar
  if (job.dryRun) {
    await page.closeModal()
    return { kind: 'finished', status: 'tested', message: `Modo teste: formulário preenchido (${activityType}) e NÃO enviado.`, patch }
  }

  // 6) Enviar e confirmar
  onStep('Enviando a atividade ao CRM…')
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
  return { kind: 'finished', status: 'done', message: `Atividade registrada no CRM (${activityType}).`, patch }
}
