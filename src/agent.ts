/**
 * Laço do piloto Gemini: tira o retrato da tela, pergunta a próxima ação, VALIDA e executa.
 * Não toca no DOM nem na rede (tudo entra por `AgentDeps`), então dá para testar com um Gemini falso.
 *
 * Garantias que não dependem do modelo:
 *  - só grava depois de o telefone do painel aberto bater com o da conversa;
 *  - o comentário é o texto exato calculado pela extensão;
 *  - em modo teste nunca clica em enviar;
 *  - ação inválida, dúvida ou lead errado = para, sem registrar.
 */

import type { CrmJob } from './types'
import { samePhone } from './crm'
import {
  AGENT_SYSTEM, buildAgentPrompt, parseAgentReply, validateAction,
  type AgentAction, type AgentElement, type FormState, type Snapshot,
} from './gemini'

export type AskResult =
  | { ok: true; text: string }
  | { ok: false; code: string; message: string }

export interface AgentDeps {
  snapshot(): Promise<Snapshot>
  ask(system: string, prompt: string): Promise<AskResult>
  perform(action: AgentAction, element: AgentElement | undefined): Promise<void>
  formState(): FormState
  closeModal(): Promise<void>
  activityCount(): number | null
  waitForNewActivity(before: number | null): Promise<boolean>
  trace(text: string): void
  sleep(ms: number): Promise<void>
  now(): number
}

export type AgentOutcome =
  | { kind: 'unavailable'; message: string }
  | { kind: 'finished'; status: 'done' | 'tested' | 'failed' | 'skipped'; message: string }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const finished = (status: 'done' | 'tested' | 'failed' | 'skipped', message: string): AgentOutcome => ({ kind: 'finished', status, message })

export async function runAgentJob(
  job: Pick<CrmJob, 'phone' | 'activityType' | 'comment' | 'dryRun'>,
  deps: AgentDeps,
  opts: { maxSteps?: number; maxMs?: number } = {}
): Promise<AgentOutcome> {
  const maxSteps = opts.maxSteps ?? 25
  const maxMs = opts.maxMs ?? 180_000
  const startedAt = deps.now()
  const history: string[] = []
  const verifiedLeads = new Set<string>()
  let invalid = 0
  let mismatches = 0
  let acted = false      // já mexeu no formulário: daqui em diante não dá mais para "voltar ao fluxo fixo"

  for (let step = 1; step <= maxSteps; step++) {
    if (deps.now() - startedAt > maxMs) return finished('failed', 'O piloto Gemini passou do tempo limite sem concluir. Nada foi enviado além do que o rastro mostra.')

    const snap = await deps.snapshot()
    const verified = snap.modalOpen && snap.modalPhones.some(p => samePhone(p, job.phone))
    const mismatch = snap.modalOpen && snap.modalPhones.length > 0 && !verified

    if (mismatch) {
      deps.trace('lead aberto com outro telefone: fechando o painel')
      history.push('O painel aberto tinha outro telefone (lead errado). O sistema fechou o painel; escolha outra linha.')
      await deps.closeModal()
      if (++mismatches >= 3) return finished('failed', 'Os leads abertos não tinham o telefone da conversa. Nada foi registrado.')
      continue
    }
    if (verified) {
      verifiedLeads.add(snap.modalKey)
      if (verifiedLeads.size > 1) {
        await deps.closeModal()
        return finished('skipped', 'Há mais de um lead com este telefone. Registre manualmente para não errar o lead.')
      }
    }

    const state = deps.formState()
    const typeOk = !!state.typeChosen && norm(state.typeChosen) === norm(job.activityType)
    const formReady = typeOk && state.commentOk
    const prompt = buildAgentPrompt(job, snap, state, verified, history)
    const reply = await deps.ask(AGENT_SYSTEM, prompt)
    if (!reply.ok) {
      if (!acted) {
        if (snap.modalOpen) await deps.closeModal()
        return { kind: 'unavailable', message: reply.message }
      }
      if (verified || state.formOpen) await deps.closeModal()
      return finished('failed', `Gemini indisponível no meio do registro: ${reply.message}`)
    }

    const val = validateAction(parseAgentReply(reply.text), snap, { ...job, phoneVerified: verified, formReady })
    if (!val.ok) {
      deps.trace(`ação recusada (${val.code}): ${val.message}`)
      history.push(`Ação recusada pelo sistema: ${val.message}`)
      if (++invalid >= 4) {
        if (verified || state.formOpen) await deps.closeModal()
        return finished('failed', `O Gemini sugeriu ações inválidas várias vezes (última: ${val.message}). Nada foi enviado.`)
      }
      continue
    }

    const { action, element } = val
    deps.trace(`passo ${step}: ${action.action}${element ? ` "${element.label}"` : ''}${action.reason ? ` · ${action.reason}` : ''}`)

    if (action.action === 'fail') {
      if (verified || state.formOpen) await deps.closeModal()
      return finished('failed', `O Gemini parou: ${action.reason || 'sem motivo informado'}. Nada foi enviado.`)
    }

    if (action.action === 'done') {
      if (!formReady) {
        history.push('Você disse done, mas o formulário ainda não está preenchido (tipo e comentário).')
        invalid++
        continue
      }
      if (job.dryRun) {
        await deps.closeModal()
        return finished('tested', `Modo teste (Gemini): formulário preenchido (${job.activityType}) e NÃO enviado.`)
      }
      history.push('Você disse done, mas a atividade ainda não foi enviada: clique no botão de enviar.')
      invalid++
      continue
    }

    if (val.intercept === 'dryrun_submit') {
      await deps.closeModal()
      return finished('tested', `Modo teste (Gemini): formulário preenchido (${job.activityType}) e o envio foi bloqueado.`)
    }

    // Envio real: só chega aqui com telefone conferido e formulário pronto (validateAction).
    if (element?.kind === 'submit') {
      const before = deps.activityCount()
      acted = true
      await deps.perform(action, element)
      const confirmed = await deps.waitForNewActivity(before)
      await deps.closeModal()
      return confirmed
        ? finished('done', 'Atividade registrada no CRM (piloto Gemini).')
        : finished('failed', 'Cliquei em enviar, mas não consegui confirmar a atividade no histórico. Confira no CRM antes de tentar de novo, para não duplicar.')
    }

    await deps.perform(action, element)
    if (element && !['search', 'button', 'link', 'tab', 'close', 'input'].includes(element.kind)) acted = true   // só campos do formulário contam como escrita
    history.push(`${action.action}${element ? ` "${element.label}"` : ''}${action.action === 'type' && element?.kind !== 'editor' ? ` "${action.text ?? ''}"` : ''}`)
    await deps.sleep(700)
  }
  return finished('failed', 'O piloto Gemini não concluiu em 25 passos. Veja o rastro na aba CRM.')
}
