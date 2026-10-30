import type { Template } from './types'

/** Variáveis calculadas automaticamente; as demais são preenchidas pelo usuário. */
export const BUILTIN_VARS = ['nome', 'primeiro_nome', 'data'] as const

const VAR_RE = /\{([a-zA-Z_À-ÿ0-9]+)\}/g

export function extractVariables(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(VAR_RE)) found.add(m[1])
  return [...found]
}

export function extraVariables(body: string): string[] {
  return extractVariables(body).filter(v => !(BUILTIN_VARS as readonly string[]).includes(v))
}

export interface RenderContext {
  contactName: string
  vars: Record<string, string>
  now?: Date
}

export interface RenderResult {
  text: string
  missing: string[]
}

export function renderTemplate(body: string, ctx: RenderContext): RenderResult {
  const now = ctx.now ?? new Date()
  const name = ctx.contactName.trim()
  const values: Record<string, string> = {
    ...ctx.vars,
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] ?? '',
    data: now.toLocaleDateString('pt-BR'),
  }
  const missing: string[] = []
  const text = body.replace(VAR_RE, (_all, key: string) => {
    const v = values[key]
    if (v === undefined || v.trim() === '') {
      if (!missing.includes(key)) missing.push(key)
      return `{${key}}`
    }
    return v
  })
  return { text, missing }
}

export const DEFAULT_TEMPLATES: Template[] = [
  { id: 'tpl-1', title: '👋 Retomada', body: 'Oi, {primeiro_nome}! Tudo bem? Passando para saber se você ficou com alguma dúvida sobre o {empreendimento}.' },
  { id: 'tpl-2', title: '🏠 Convite para visita', body: 'Olá, {primeiro_nome}! Que tal conhecer o {empreendimento} pessoalmente? Tenho horários disponíveis nesta semana.' },
  { id: 'tpl-3', title: '📄 Proposta', body: 'Oi, {primeiro_nome}! Conseguiu analisar a simulação que enviei do {empreendimento}? Posso ajustar algo para você.' },
  { id: 'tpl-4', title: '🔔 Lembrete', body: 'Olá, {primeiro_nome}! Só um lembrete sobre nossa conversa. Posso te ajudar em algo hoje ({data})?' },
]
