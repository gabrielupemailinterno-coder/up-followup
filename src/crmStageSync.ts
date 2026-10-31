/**
 * Kanban → CRM: quando um card ligado ao CRM muda de coluna, descobre a etapa equivalente
 * e enfileira a mudança de etapa no CRM (o executor confere o telefone antes de mexer).
 */

import type { KanbanCard } from './types'
import { sendToBackground } from './types'
import { getCrmStages, getKanbanColumns, getSettings } from './storage'
import { normTitle, stageForColumn } from './crmSync'

/** Etapa do CRM para onde o card iria, ou null se não for card do CRM ou se a etapa não muda. */
export async function crmStageForMove(card: KanbanCard, columnId: string): Promise<string | null> {
  if (!card.crmStage || !card.phone) return null
  const [settings, columns, stages] = await Promise.all([getSettings(), getKanbanColumns(), getCrmStages()])
  const target = stageForColumn(columnId, columns, settings.crmStageMap, stages.length ? stages : [card.crmStage])
  return target && normTitle(target) !== normTitle(card.crmStage) ? target : null
}

/** Enfileira a mudança no CRM e devolve o card já com a etapa nova (a próxima sincronização não o move de volta). */
export async function enqueueCrmStage(card: KanbanCard, target: string): Promise<{ card: KanbanCard; error?: string }> {
  const r = await sendToBackground({ type: 'CRM_STAGE_ENQUEUE', payload: { phone: card.phone, contactName: card.contactName, targetStage: target } })
  if (!r.ok) return { card, error: r.message }
  return { card: { ...card, crmStage: target } }
}
