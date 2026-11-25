/**
 * Regras para salvar os membros de um grupo do WhatsApp como cards do Kanban.
 */

import type { KanbanCard } from './types'
import { formatPhone, normalizePhone } from './phone'

export interface GroupMember {
  name: string
  phone: string   // dígitos com código do país, como o WhatsApp informa
}

/** Chave para comparar telefones: no Brasil, ignora o nono dígito (o WhatsApp às vezes omite). */
export function phoneKey(phone: string): string {
  const m = phone.match(/^55(\d{2})9?(\d{8})$/)
  return m ? `55${m[1]}${m[2]}` : phone
}

export interface GroupImportResult {
  cards: KanbanCard[]   // lista completa do quadro, já com os novos
  created: number
  existing: number      // já estavam no quadro: ganham só a tag do grupo
  invalid: number
}

export function mergeGroupMembers(
  members: GroupMember[],
  cards: KanbanCard[],
  columnId: string,
  tag: string,
  now = Date.now(),
): GroupImportResult {
  const next = [...cards]
  const byKey = new Map<string, number>()
  next.forEach((c, i) => { if (c.phone) byKey.set(phoneKey(c.phone), i) })
  const seen = new Set<string>()
  let order = next.reduce((max, c) => Math.max(max, c.order), -1)
  let created = 0
  let existing = 0
  let invalid = 0

  for (const member of members) {
    const phone = normalizePhone(`+${member.phone}`)
    if (!phone) { invalid++; continue }
    const key = phoneKey(phone)
    if (seen.has(key)) continue
    seen.add(key)

    const found = byKey.get(key)
    if (found !== undefined) {
      existing++
      const card = next[found]
      if (tag && !card.tags.includes(tag)) next[found] = { ...card, tags: [...card.tags, tag], updatedAt: now }
      continue
    }

    created++
    next.push({
      id: `grp_${now}_${created}_${Math.random().toString(36).slice(2, 7)}`,
      contactName: member.name.trim() || formatPhone(phone),
      phone,
      columnId,
      columnChangedAt: now,
      columnHistory: [{ columnId, at: now }],
      tags: tag ? [tag] : [],
      notes: '',
      lastMessage: '',
      lastMessageAt: now,
      order: ++order,
      createdAt: now,
      updatedAt: now,
    })
  }
  return { cards: next, created, existing, invalid }
}
