/**
 * Quem pediu para não receber: card na etapa "Sem interesse" (em qualquer quadro)
 * ou com a tag "Pediu para sair". Nenhum envio da extensão sai para esses contatos.
 */

import type { KanbanCard, KanbanColumn } from './types'
import { getBoards, getKanbanCards, getKanbanColumns } from './storage'
import { phoneKey } from './groupImport'

export const BLOCK_STAGE = 'Sem interesse'
export const BLOCK_TAG = 'Pediu para sair'
export const BLOCK_REASON = `Bloqueado: pediu para não receber (etapa "${BLOCK_STAGE}" ou tag "${BLOCK_TAG}").`

const same = (a: string, b: string) => a.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase() === b.toLowerCase()

/** Chaves de telefone bloqueadas, a partir de um conjunto de colunas e cards. */
export function blockedKeys(columns: KanbanColumn[], cards: KanbanCard[], into = new Set<string>()): Set<string> {
  const stages = new Set(columns.filter(c => same(c.title, BLOCK_STAGE)).map(c => c.id))
  for (const card of cards) {
    if (card.phone && (stages.has(card.columnId) || card.tags?.some(t => same(t, BLOCK_TAG)))) into.add(phoneKey(card.phone))
  }
  return into
}

/** Lê todos os quadros: o bloqueio vale mesmo que o card esteja em outro funil. */
export async function getBlockedKeys(): Promise<Set<string>> {
  const out = new Set<string>()
  for (const board of await getBoards()) {
    blockedKeys(await getKanbanColumns(board.id), await getKanbanCards(board.id), out)
  }
  return out
}
