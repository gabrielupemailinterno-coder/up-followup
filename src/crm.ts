/**
 * Regras do CRM Incbook, sem DOM: formato do telefone, tipo de atividade, comentário,
 * trava de duplicidade e casamento de lead.
 */

import type { AppSettings, CrmJob, CrmLead } from './types'
import { normalizePhone } from './phone'

/** O CRM guarda e busca o telefone formatado: "(31) 99999-9999" ou "(31) 3333-4444". */
export function formatPhoneForCrm(phone: string): string | null {
  const m = phone.match(/^55(\d{2})(\d{8,9})$/)
  if (!m) return null
  const [, ddd, rest] = m
  const cut = rest.length - 4
  return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`
}

/** Tamanho de uma página de resultados do CRM: página cheia = lista possivelmente incompleta. */
export const CRM_PAGE_SIZE = 50

/**
 * Consultas para achar um telefone na busca do CRM, da mais tolerante para a mais específica.
 * Os 4 últimos dígitos funcionam em qualquer formato de armazenamento; as outras só entram
 * quando a primeira devolve uma página cheia (pode haver mais leads do que os 50 visíveis).
 */
export function phoneSearchQueries(phone: string): string[] {
  const m = phone.match(/^55(\d{2})(\d{8,9})$/)
  if (!m) return []
  const rest = m[2]
  const last4 = rest.slice(-4)
  const head = rest.slice(0, -4)
  return [last4, `${head}-${last4}`, `(${m[1]}) ${head}-${last4}`]
}

/** Dois telefones são "o mesmo" se iguais, ou se só diferem no 9º dígito do celular. */
export function samePhone(a: string, b: string): boolean {
  const pa = normalizePhone(a)
  const pb = normalizePhone(b)
  if (!pa || !pb) return false
  if (pa === pb) return true
  if (pa.startsWith('55') && pb.startsWith('55')) {
    return pa.slice(2, 4) === pb.slice(2, 4) && pa.slice(-8) === pb.slice(-8)
  }
  return false
}

export function pickActivityType(
  priorSendsToPhone: number,
  settings: Pick<AppSettings, 'crmFirstType' | 'crmFollowupType'>
): string {
  return priorSendsToPhone <= 0 ? settings.crmFirstType : settings.crmFollowupType
}

/** Comentário da atividade: uma linha, com o início do texto enviado. */
export function buildActivityComment(text: string, maxLen = 200): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const snippet = oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine
  return `Enviado via WhatsApp (Follow-up UP): ${snippet}`
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Mesma atividade, para o mesmo telefone, no mesmo dia = duplicada. */
export function makeDedupeKey(phone: string, activityType: string, comment: string, now: number): string {
  let h = 0
  for (const ch of comment) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${phone}|${activityType}|${dayKey(now)}|${h.toString(36)}`
}

export function isDuplicate(jobs: CrmJob[], dedupeKey: string): boolean {
  return jobs.some(j => j.dedupeKey === dedupeKey && j.status !== 'failed' && j.status !== 'skipped')
}

export type LeadMatch =
  | { kind: 'one'; lead: CrmLead }
  | { kind: 'none' }
  | { kind: 'many'; count: number }

/** Casa um telefone com os leads conhecidos. Mais de um lead = ambíguo: não registra. */
export function matchLeadByPhone(leads: CrmLead[], phone: string): LeadMatch {
  const hits = leads.filter(l => l.phones.some(p => samePhone(p, phone)))
  if (hits.length === 1) return { kind: 'one', lead: hits[0] }
  if (hits.length === 0) return { kind: 'none' }
  return { kind: 'many', count: hits.length }
}

/** Tipos de atividade vistos no CRM (30/10/2026). O texto precisa bater exatamente com a opção do CRM. */
export const CRM_ACTIVITY_TYPES = [
  '0 - Anotação e informações extras',
  '1 - Tentativa de contato',
  '2A - Atendimento Novo',
  '2B - Atendimento Base',
  '2C - Reunião agendada',
  '3 - Reunião realizada',
  '4A - Negociação iniciada',
  '4B - Follow-up realizado',
  '5 - Formalização iniciada',
]

const DAY = 86_400_000

export interface StaleLead {
  lead: CrmLead
  daysInStage: number
  noActionInStage: boolean
}

/**
 * Leads parados: sem nenhuma interação desde que entraram na etapa (referência de inatividade
 * não passou da entrada) e há mais de `minDays` dias na etapa.
 */
export function findStaleLeads(leads: CrmLead[], now: number, minDays = 2): StaleLead[] {
  const out: StaleLead[] = []
  for (const lead of leads) {
    const st = lead.stage
    if (!st || !st.enteredAt) continue
    const daysInStage = (now - st.enteredAt) / DAY
    const noActionInStage = st.lastInteractionAt <= st.enteredAt
    if (noActionInStage && daysInStage >= minDays) out.push({ lead, daysInStage, noActionInStage })
  }
  return out.sort((a, b) => b.daysInStage - a.daysInStage)
}
