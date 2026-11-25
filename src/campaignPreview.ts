/**
 * O que vai acontecer se a campanha for iniciada agora: quem recebe, avisos, destino dos cards
 * e tempo estimado. Função pura.
 */

import type { AppSettings, Campaign, KanbanBoard, KanbanCard, KanbanColumn } from './types'
import { phoneKey } from './groupImport'
import { extractVariables, realName, renderTemplate } from './templates'
import { blockedKeys } from './optOut'

export interface PreviewInput {
  campaign: Campaign
  campaigns: Campaign[]
  boards: KanbanBoard[]
  columns: Record<string, KanbanColumn[]>
  cards: Record<string, KanbanCard[]>
  settings: AppSettings
  hasImage: boolean          // a imagem anexada foi encontrada
  now?: number
}

export interface Recipient {
  phone: string
  name: string               // vazio quando o contato não tem nome
  stage: string              // "Quadro / Etapa" de onde está hoje
  problems: string[]
  blocked: boolean           // pediu para não receber: será pulado
}

export interface CampaignPreview {
  recipients: Recipient[]    // só os pendentes, na ordem de envio
  sending: number            // quantos realmente vão receber (sem os bloqueados)
  alerts: { level: 'stop' | 'warn'; text: string }[]
  actions: string[]          // o que acontece a cada envio e no andamento
  seconds: number            // duração estimada
  pauses: number
}

/** Tempo médio para abrir a conversa e enviar, além do intervalo configurado. */
const SEND_OVERHEAD_S = 10
const LOST_STAGE = /perdido/i

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function formatDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

export function buildCampaignPreview(input: PreviewInput): CampaignPreview {
  const { campaign: c, boards, columns, cards, settings, hasImage, now = Date.now() } = input
  const queued = c.items.filter(i => i.status === 'pending' || i.status === 'sending')
  const blocked = new Set<string>()
  for (const board of boards) blockedKeys(columns[board.id] ?? [], cards[board.id] ?? [], blocked)
  const pending = queued.filter(i => !blocked.has(phoneKey(i.phone)))
  const skippedCount = queued.length - pending.length

  // Onde cada contato está hoje.
  const where = new Map<string, { board: KanbanBoard; column?: KanbanColumn }[]>()
  for (const board of boards) {
    for (const card of cards[board.id] ?? []) {
      if (!card.phone) continue
      const k = phoneKey(card.phone)
      const column = (columns[board.id] ?? []).find(col => col.id === card.columnId)
      where.set(k, [...(where.get(k) ?? []), { board, column }])
    }
  }

  // Outras campanhas com os mesmos contatos.
  const alsoPending = new Map<string, number>()
  const recently = new Set<string>()
  const mine = new Set(pending.map(i => phoneKey(i.phone)))
  for (const other of input.campaigns) {
    if (other.id === c.id) continue
    const open = other.status === 'draft' || other.status === 'running' || other.status === 'paused'
    let count = 0
    for (const i of other.items) {
      const k = phoneKey(i.phone)
      if (!mine.has(k)) continue
      if (open && i.status === 'pending') count++
      if (i.status === 'sent' && i.sentAt && now - i.sentAt < 48 * 3600_000) recently.add(k)
    }
    if (count) alsoPending.set(other.name, (alsoPending.get(other.name) ?? 0) + count)
  }

  const usesName = c.variants.some(v => extractVariables(v).some(x => x === 'nome' || x === 'primeiro_nome'))
  let nameless = 0
  let stopped = 0
  let withoutCard = 0
  let goingBack = 0
  const destinations = new Set<string>()

  const recipients: Recipient[] = queued.map(item => {
    const places = where.get(phoneKey(item.phone)) ?? []
    const name = realName(item.name)
    const problems: string[] = []
    const stage = places.map(p => `${p.board.name} / ${p.column?.title ?? '?'}`).join(' · ') || 'fora do Kanban'
    if (blocked.has(phoneKey(item.phone))) {
      return { phone: item.phone, name, stage, problems: ['pediu para não receber: não vai ser enviado'], blocked: true }
    }
    if (usesName && !name) { nameless++; problems.push('sem nome: vai falhar') }
    if (places.some(p => p.column && LOST_STAGE.test(p.column.title))) { stopped++; problems.push('está em etapa "Perdido"') }
    if (c.moveToColumnId) {
      // Mesma regra do envio: o primeiro quadro que tem a etapa de destino e o contato.
      const hit = places.find(p => (columns[p.board.id] ?? []).some(col => col.id === c.moveToColumnId))
      const target = hit && (columns[hit.board.id] ?? []).find(col => col.id === c.moveToColumnId)
      if (!hit || !target) withoutCard++
      else {
        destinations.add(`${hit.board.name} / ${target.title}`)
        if (hit.column && hit.column.order > target.order) { goingBack++; problems.push(`vai voltar para "${target.title}"`) }
      }
    }
    return { phone: item.phone, name, stage, problems, blocked: false }
  })

  const alerts: CampaignPreview['alerts'] = []
  if (!pending.length) alerts.push({ level: 'stop', text: 'Não há contatos pendentes: nada será enviado.' })
  if (c.imageId && !hasImage) alerts.push({ level: 'stop', text: 'A imagem anexada não foi encontrada. Anexe de novo antes de iniciar.' })
  const missing = new Set(pending.slice(0, 1).flatMap(i => c.variants.flatMap(v =>
    renderTemplate(v, { contactName: i.name, vars: c.vars }).missing.filter(m => m !== 'nome' && m !== 'primeiro_nome'))))
  if (missing.size) alerts.push({ level: 'stop', text: `Falta preencher: ${[...missing].map(m => `{${m}}`).join(', ')}.` })
  if (nameless) alerts.push({ level: 'stop', text: `${plural(nameless, 'contato não tem nome', 'contatos não têm nome')}, mas as mensagens usam o nome: o envio vai falhar para ${nameless === 1 ? 'ele' : 'eles'}.` })
  if (skippedCount) alerts.push({ level: 'warn', text: `${plural(skippedCount, 'contato pediu para não receber e será pulado', 'contatos pediram para não receber e serão pulados')}.` })
  if (stopped) alerts.push({ level: 'stop', text: `${plural(stopped, 'contato está', 'contatos estão')} em "Perdido".` })
  if (goingBack) alerts.push({ level: 'warn', text: `${plural(goingBack, 'contato está', 'contatos estão')} em etapa mais avançada e ${goingBack === 1 ? 'vai voltar' : 'vão voltar'} depois do envio.` })
  for (const [name, n] of alsoPending) alerts.push({ level: 'warn', text: `${plural(n, 'contato também está pendente', 'contatos também estão pendentes')} na campanha "${name}".` })
  if (recently.size) alerts.push({ level: 'warn', text: `${plural(recently.size, 'contato já recebeu', 'contatos já receberam')} outra campanha nas últimas 48 horas.` })
  if (!c.imageId) alerts.push({ level: 'warn', text: 'Sem imagem anexada: vai somente texto.' })
  if (pending.length > 100) alerts.push({ level: 'warn', text: `Disparo grande (${pending.length} contatos): maior risco de bloqueio do número.` })

  const every = settings.batchSize
  const pauses = every > 0 && pending.length > 1 ? Math.floor((pending.length - 1) / every) : 0
  const gaps = Math.max(0, pending.length - 1)
  const seconds = pending.length * SEND_OVERHEAD_S + (gaps - pauses) * (c.minSec + c.maxSec) / 2
    + pauses * (settings.batchPauseMinMin + settings.batchPauseMaxMin) * 30

  const actions = [
    `Envia para ${plural(pending.length, 'contato', 'contatos')}, um de cada vez, na ordem da lista.`,
    `Cada um recebe uma das ${c.variants.length} variações, sorteada.`,
    c.imageId ? 'A mensagem vai junto com a imagem, como legenda.' : 'A mensagem vai como texto.',
    ...(c.link ? [`Depois sai uma segunda mensagem com o link (${c.link.style === 'button' ? `botão "${c.link.label}"` : 'cartão com prévia'}).`] : []),
    `Espera de ${c.minSec} a ${c.maxSec} segundos entre um envio e outro.`,
    ...(pauses ? [`Faz ${plural(pauses, 'pausa maior', 'pausas maiores')} de ${settings.batchPauseMinMin} a ${settings.batchPauseMaxMin} min (a cada ${every} envios).`] : []),
    c.moveToColumnId
      ? destinations.size
        ? `Depois de enviar, move o card para ${[...destinations].join(' ou ')}.${withoutCard ? ` ${plural(withoutCard, 'contato sem card não é movido', 'contatos sem card não são movidos')}.` : ''}`
        : 'A etapa de destino não vale para nenhum destes contatos: nenhum card será movido.'
      : 'Os cards não mudam de etapa.',
    `Marca o card com a tag "Recebeu: ${c.name}".`,
    `Pausa sozinha depois de ${settings.maxConsecutiveFailures} falhas seguidas ou aviso de restrição.`,
  ]

  return { recipients, sending: pending.length, alerts, actions, seconds, pauses }
}
