/**
 * Piloto Gemini do CRM, parte pura (sem DOM e sem rede): formato do "retrato" da tela, prompt,
 * leitura da resposta e, principalmente, a VALIDAÇÃO de cada ação sugerida pelo modelo.
 * O modelo só sugere; quem decide se uma ação roda é o código daqui.
 */

import { formatPhoneForCrm } from './crm'

export type ElementKind =
  | 'search' | 'select' | 'select-search' | 'editor' | 'option' | 'submit' | 'close' | 'button' | 'link' | 'tab' | 'input'

export interface AgentElement {
  id: number
  kind: ElementKind
  label: string
  value?: string
  disabled?: boolean
  /** Texto da linha da tabela onde o botão está (ajuda a escolher o lead certo). */
  context?: string
  /** Só caminho interno do CRM; link para fora nem entra no retrato. */
  href?: string
}

export interface Snapshot {
  path: string
  title: string
  modalOpen: boolean
  /** Identifica o lead aberto no painel (para detectar dois leads diferentes com o mesmo telefone). */
  modalKey: string
  modalPhones: string[]
  rowCount: number
  text: string
  elements: AgentElement[]
}

export type AgentActionName = 'click' | 'click_at' | 'type' | 'wait' | 'done' | 'fail'

export interface AgentAction {
  action: AgentActionName
  target?: number
  /** click_at: posição do mouse em pixels da janela (como na imagem da tela). */
  x?: number
  y?: number
  text?: string
  reason: string
}

export interface FormState {
  formOpen: boolean
  typeChosen: string | null
  commentOk: boolean
}

export interface AgentGoal {
  phone: string
  activityType: string
  comment: string
  dryRun: boolean
}

export interface ValidationContext extends AgentGoal {
  phoneVerified: boolean
  formReady: boolean
  /** Descobre qual elemento (já classificado) está sob o ponto x,y; null se não houver nada clicável. */
  probe?: (x: number, y: number) => AgentElement | null
}

export type Validation =
  | { ok: true; action: AgentAction; element?: AgentElement; intercept?: 'dryrun_submit' }
  | { ok: false; code: string; message: string }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Rótulos que o piloto nunca pode clicar: apagam, movem, enviam ou compartilham o lead. */
export const BLOCKED_LABEL = /excluir|remover|apagar|deletar|transferir|descartar|arquivar|desativar|sair|logout|perdid|enviar|disparar|mover|duplicar|exportar|importar|compartilhar|delete|remove|send|share|archive/i

const ACTIONS: AgentActionName[] = ['click', 'click_at', 'type', 'wait', 'done', 'fail']
const WHEN_OPTION = /^(agora|hoje|now|imediat)/i

export function validateAction(raw: unknown, snap: Snapshot, ctx: ValidationContext): Validation {
  const bad = (code: string, message: string): Validation => ({ ok: false, code, message })
  if (!raw || typeof raw !== 'object') return bad('format', 'Resposta do modelo não é um objeto.')
  const r = raw as Record<string, unknown>
  if (typeof r.action !== 'string' || !ACTIONS.includes(r.action as AgentActionName)) return bad('action', `Ação desconhecida: ${String(r.action)}.`)
  const action: AgentAction = {
    action: r.action as AgentActionName,
    reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '',
  }
  if (action.action === 'wait' || action.action === 'done' || action.action === 'fail') return { ok: true, action }

  let el: AgentElement | undefined | null
  if (action.action === 'click_at') {
    if (typeof r.x !== 'number' || typeof r.y !== 'number') return bad('target', 'click_at precisa de x e y.')
    action.x = Math.round(r.x); action.y = Math.round(r.y)
    el = ctx.probe?.(action.x, action.y)
    if (!el) return bad('target', `Não há nada clicável em (${action.x}, ${action.y}).`)
  } else {
    const id = typeof r.target === 'number' ? r.target : Number.NaN
    el = snap.elements.find(e => e.id === id)
    if (!el) return bad('target', `O elemento ${String(r.target)} não existe na tela atual.`)
  }
  if (el.disabled) return bad('disabled', `O elemento "${el.label}" está desabilitado.`)
  action.target = el.id

  if (action.action === 'click' || action.action === 'click_at') {
    if (el.kind === 'submit') {
      if (!ctx.phoneVerified) return bad('not_verified', 'Só dá para enviar depois de o telefone do lead aberto ser conferido.')
      if (!ctx.formReady) return bad('not_ready', 'O formulário ainda não está preenchido (tipo da atividade e comentário).')
      return { ok: true, action, element: el, intercept: ctx.dryRun ? 'dryrun_submit' : undefined }
    }
    if (BLOCKED_LABEL.test(el.label)) return bad('blocked', `Clique recusado: "${el.label}" é uma ação não permitida.`)
    if (el.kind === 'link' && !el.href) return bad('link', 'Link sem destino interno do CRM.')
    if (el.kind === 'option') {
      if (!ctx.phoneVerified) return bad('not_verified', 'Escolher opção só depois de conferir o telefone do lead.')
      if (norm(el.label) !== norm(ctx.activityType) && !WHEN_OPTION.test(el.label.trim())) {
        return bad('option', `Opção "${el.label}" não permitida: só "${ctx.activityType}" e "Agora/Hoje".`)
      }
    }
    return { ok: true, action, element: el }
  }

  // type
  const text = typeof r.text === 'string' ? r.text : ''
  if (el.kind === 'search') {
    if (text.length < 1 || text.length > 40) return bad('type', 'Texto da busca vazio ou grande demais.')
    action.text = text
    return { ok: true, action, element: el }
  }
  if (el.kind === 'select-search') {
    if (!ctx.phoneVerified) return bad('not_verified', 'Só dá para preencher a atividade depois de conferir o telefone.')
    if (text.length < 1 || text.length > 40) return bad('type', 'Texto vazio ou grande demais.')
    action.text = text
    return { ok: true, action, element: el }
  }
  if (el.kind === 'editor') {
    if (!ctx.phoneVerified) return bad('not_verified', 'Só dá para escrever o comentário depois de conferir o telefone.')
    action.text = ctx.comment      // o código define o texto; o modelo só aponta o campo
    return { ok: true, action, element: el }
  }
  return bad('type', `Não é permitido digitar em "${el.label}".`)
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

export const AGENT_SYSTEM = [
  'Você opera o CRM Incbook (imobiliário, Brasil) clicando na tela, como um corretor faria, para registrar UMA atividade em UM lead.',
  'A cada resposta você escolhe UMA ação: click (id do elemento), click_at (x,y: mover o mouse e clicar num ponto da tela, em pixels da janela, quando o elemento não está na lista), type (id do campo), wait, done ou fail.',
  'Use apenas ids que estão na lista de elementos atual. Nunca invente ids.',
  'Nunca altere dados do lead, não mude de etapa, não envie, exclua, mova ou compartilhe leads.',
  'O sistema confere o telefone do lead aberto e digita o comentário por você; no campo do comentário use type (o texto é ignorado e substituído).',
  'Se algo não bater (lead errado, telefone diferente, mais de um lead com o mesmo telefone, tela inesperada), responda fail explicando.',
  'Responda somente com o JSON pedido.',
].join('\n')

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ACTIONS },
    target: { type: 'INTEGER' },
    x: { type: 'NUMBER' },
    y: { type: 'NUMBER' },
    text: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: ['action', 'reason'],
}

export function describeElement(e: AgentElement): string {
  const parts = [`[${e.id}] ${e.kind} "${e.label}"`]
  if (e.value) parts.push(`valor="${e.value}"`)
  if (e.disabled) parts.push('(desabilitado)')
  if (e.context) parts.push(`linha: ${e.context}`)
  return parts.join(' ')
}

export function buildAgentPrompt(goal: AgentGoal, snap: Snapshot, state: FormState, phoneVerified: boolean, history: string[]): string {
  const shown = formatPhoneForCrm(goal.phone) ?? goal.phone
  const last4 = goal.phone.slice(-4)
  const lines = [
    `OBJETIVO: registrar uma atividade do tipo "${goal.activityType}" no lead cujo telefone é ${shown} (final ${last4}).`,
    goal.dryRun
      ? 'MODO TESTE: preencha o formulário, mas NÃO envie. Quando o tipo e o comentário estiverem preenchidos, responda done.'
      : 'MODO REAL: preencha o formulário, clique no botão que envia a atividade e depois responda done.',
    'DICA DO CRM: buscar os 4 últimos dígitos costuma listar vários leads (a lista não mostra telefone): abra um por vez e o sistema confere o telefone do painel; se não for o certo, feche e abra o próximo.',
    'CAMINHO TÍPICO: na tela Leads digite SOMENTE os 4 últimos dígitos do telefone na busca (nunca o número inteiro); clique no nome do lead da lista; (o sistema confere o telefone do painel); o formulário "Ações" já aparece no painel do lead (o botão "Adicionar Atividade" é o que ENVIA); abra o campo "Tipo de Atividade" e escolha o tipo pedido; ajuste o campo "Quando" para agora/hoje se estiver vazio; clique no campo do comentário e use type; envie (só no modo real).',
    '',
    `ESTADO: tela=${snap.path} · painel aberto=${snap.modalOpen ? 'sim' : 'não'} · telefone do painel conferido pelo sistema=${phoneVerified ? 'SIM' : 'não'} · formulário aberto=${state.formOpen ? 'sim' : 'não'} · tipo escolhido=${state.typeChosen ?? 'nenhum'} · comentário preenchido=${state.commentOk ? 'sim' : 'não'} · linhas na lista=${snap.rowCount}`,
  ]
  if (history.length) lines.push('', 'AÇÕES JÁ FEITAS (mais recentes por último):', ...history.slice(-12).map(h => `- ${h}`))
  lines.push('', 'TEXTO VISÍVEL (resumo):', snap.text.slice(0, 2500), '', 'ELEMENTOS CLICÁVEIS:', ...snap.elements.map(describeElement))
  return lines.join('\n')
}

/** Lê o JSON da resposta do modelo, tolerando cercas de código. */
export function parseAgentReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { return null }
}
