import type { Campaign, CampaignAudience, CampaignItem, KanbanCard } from './types'
import { formatPhone, normalizePhone } from './phone'
import { extractVariables, extraVariables } from './templates'

export const MIN_VARIANTS = 5

export type Rng = () => number

export function pickVariantIndex(count: number, rng: Rng = Math.random): number {
  return Math.min(count - 1, Math.floor(rng() * count))
}

/** Atraso aleatório uniforme entre minSec e maxSec (inclusive), em ms. */
export function randomDelayMs(minSec: number, maxSec: number, rng: Rng = Math.random): number {
  const lo = Math.min(minSec, maxSec)
  const hi = Math.max(minSec, maxSec)
  return Math.round((lo + rng() * (hi - lo)) * 1000)
}

export interface PastedEntry {
  name: string
  phone: string
}

/** Linhas "nome;telefone", "telefone" ou separadas por tab/vírgula. */
export function parsePastedList(text: string): { entries: PastedEntry[]; invalid: string[] } {
  const entries: PastedEntry[] = []
  const invalid: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(/[;\t,]/).map(p => p.trim()).filter(Boolean)
    let name = ''
    let phoneRaw = ''
    if (parts.length === 1) {
      phoneRaw = parts[0]
    } else {
      const phoneIdx = parts.findIndex(p => normalizePhone(p) !== null)
      if (phoneIdx < 0) {
        invalid.push(line)
        continue
      }
      phoneRaw = parts[phoneIdx]
      name = parts.filter((_, i) => i !== phoneIdx).join(' ')
    }
    const phone = normalizePhone(phoneRaw)
    if (!phone) invalid.push(line)
    else entries.push({ name, phone })
  }
  return { entries, invalid }
}

export interface AudienceInput {
  audience: CampaignAudience
  cards: KanbanCard[]
  pastedText: string
}

/** Monta os itens da campanha, sem telefones duplicados. */
export function buildItems(input: AudienceInput): { items: CampaignItem[]; invalidLines: string[] } {
  const seen = new Set<string>()
  const items: CampaignItem[] = []
  const add = (name: string, phone: string) => {
    if (!phone || seen.has(phone)) return
    seen.add(phone)
    items.push({ phone, name, status: 'pending' })
  }

  const { audience } = input
  if (audience.kind === 'kanban' || audience.kind === 'both') {
    for (const c of input.cards) {
      if (audience.columnId && c.columnId !== audience.columnId) continue
      if (audience.tag && !c.tags.includes(audience.tag)) continue
      add(c.contactName, c.phone)
    }
  }
  let invalidLines: string[] = []
  if (audience.kind === 'pasted' || audience.kind === 'both') {
    const parsed = parsePastedList(input.pastedText)
    invalidLines = parsed.invalid
    for (const e of parsed.entries) add(e.name || formatPhone(e.phone), e.phone)
  }
  return { items, invalidLines }
}

export interface CampaignDraft {
  name: string
  variants: string[]
  vars: Record<string, string>
  minSec: number
  maxSec: number
  items: CampaignItem[]
}

/** Retorna a lista de problemas; vazia = campanha válida. */
export function validateCampaign(draft: CampaignDraft, floorSec: number): string[] {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push('Dê um nome à campanha.')
  if (draft.items.length === 0) errors.push('Nenhum contato válido no público escolhido.')

  const variants = draft.variants.map(v => v.trim())
  const filled = variants.filter(Boolean)
  if (filled.length < MIN_VARIANTS) {
    errors.push(`Escreva pelo menos ${MIN_VARIANTS} variações de mensagem (você tem ${filled.length}).`)
  }
  if (new Set(filled.map(v => v.toLowerCase())).size < filled.length) {
    errors.push('Há variações repetidas. Cada variação precisa ser diferente.')
  }

  const varSets = filled.map(v => extractVariables(v).sort().join('|'))
  if (new Set(varSets).size > 1) {
    errors.push('Todas as variações devem usar as mesmas variáveis.')
  }

  const extras = [...new Set(filled.flatMap(v => extraVariables(v)))]
  const missing = extras.filter(v => !(draft.vars[v] ?? '').trim())
  if (missing.length > 0) errors.push(`Preencha: ${missing.map(v => `{${v}}`).join(', ')}.`)

  const usesName = filled.some(v => /\{(nome|primeiro_nome)\}/.test(v))
  if (usesName) {
    const nameless = draft.items.filter(i => !i.name.trim()).length
    if (nameless > 0) errors.push(`${nameless} contato(s) sem nome, mas as mensagens usam {nome}/{primeiro_nome}.`)
  }

  if (draft.minSec < floorSec) errors.push(`O intervalo mínimo não pode ser menor que ${floorSec}s.`)
  if (draft.maxSec < draft.minSec) errors.push('O intervalo máximo deve ser maior ou igual ao mínimo.')
  return errors
}

export function campaignProgress(c: Campaign) {
  const total = c.items.length
  const sent = c.items.filter(i => i.status === 'sent').length
  const failed = c.items.filter(i => i.status === 'failed').length
  const pending = c.items.filter(i => i.status === 'pending' || i.status === 'sending').length
  return { total, sent, failed, pending, done: sent + failed }
}

/** 09:00 do dia seguinte (horário local), usado quando o limite diário é atingido. */
export function nextMorning(from = Date.now(), hour = 9): number {
  const d = new Date(from)
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}
