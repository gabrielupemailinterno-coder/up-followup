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
import { CRM_PAGE_SIZE, formatPhoneForCrm, phoneSearchQueries, samePhone } from './crm'

/** Quantas linhas da busca estamos dispostos a abrir e conferir, uma a uma. */
export const MAX_ROW_CANDIDATES = 5

export interface CrmPageAdapter {
  path(): string
  /** Navegação para outra tela do CRM (preferir o link do menu). */
  goto(path: string): void
  /** Digita `query` na busca da tela Leads e devolve quantas linhas a lista mostra depois de atualizar. */
  searchLeadRows(query: string): Promise<number>
  /** Clica no nome do lead da linha `index` e espera o painel abrir. */
  openLeadRow(index: number): Promise<boolean>
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
  /** Precisa trocar de tela. Quem chama grava `patch` PRIMEIRO e só então navega para `to`. */
  | { kind: 'navigating'; to: string; patch?: Partial<CrmJob> }
  | { kind: 'finished'; status: 'done' | 'tested' | 'failed' | 'skipped'; message: string; patch?: Partial<CrmJob> }

const fail = (message: string): StepResult => ({ kind: 'finished', status: 'failed', message })

export async function runJobStep(
  job: CrmJob,
  page: CrmPageAdapter,
  onStep: (text: string) => void = () => {}
): Promise<StepResult> {
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

  // 4) Preencher o formulário
  onStep('Preenchendo a atividade…')
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
  return { kind: 'finished', status: 'done', message: 'Atividade registrada no CRM.' }
}
