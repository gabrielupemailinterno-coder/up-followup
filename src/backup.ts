import type { BackupFile, KanbanCard, KanbanColumn } from './types'
import { SCHEMA_VERSION } from './types'
import {
  getKanbanCards, getKanbanColumns, getScheduledMessages, getTemplates, getSettings,
  saveAllKanbanCards, saveKanbanColumns, saveAllScheduledMessages, saveTemplates, saveSettings,
  migrateCards, migrateSchedules,
  getCampaigns, getTasks, getSendHistory, saveAllCampaigns, saveAllTasks, saveAllSendHistory,
} from './storage'
import { DEFAULT_SETTINGS } from './storage'

export async function buildBackup(): Promise<BackupFile> {
  const [columns, cards, schedules, templates, settings, campaigns, tasks, history] = await Promise.all([
    getKanbanColumns(), getKanbanCards(), getScheduledMessages(), getTemplates(), getSettings(),
    getCampaigns(), getTasks(), getSendHistory(),
  ])
  return {
    app: 'whatsapp-web-mod',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    columns, cards, schedules, templates, settings, campaigns, tasks, history,
  }
}

/** Valida e restaura um backup. Lança Error com mensagem legível se o arquivo for inválido. */
export async function restoreBackup(raw: unknown): Promise<void> {
  const b = raw as Partial<BackupFile> | null
  if (!b || b.app !== 'whatsapp-web-mod') throw new Error('Arquivo não é um backup do WhatsApp Web Mod.')
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
    throw new Error('Backup de uma versão mais nova da extensão. Atualize a extensão e tente de novo.')
  }
  if (!Array.isArray(b.columns) || !Array.isArray(b.cards) || !Array.isArray(b.schedules) || !Array.isArray(b.templates)) {
    throw new Error('Backup incompleto ou corrompido.')
  }
  const columnIds = new Set((b.columns as KanbanColumn[]).map(c => c.id))
  const orphan = (b.cards as KanbanCard[]).find(c => !columnIds.has(c.columnId))
  if (orphan) throw new Error(`Card "${orphan.contactName}" aponta para uma coluna que não existe no backup.`)

  await saveKanbanColumns(b.columns)
  await saveAllKanbanCards(migrateCards(b.cards))
  await saveAllScheduledMessages(migrateSchedules(b.schedules))
  await saveTemplates(b.templates)
  await saveSettings({ ...DEFAULT_SETTINGS, ...(b.settings ?? {}) })
  // Campanhas restauradas nunca voltam rodando: o usuário decide retomar.
  await saveAllCampaigns((b.campaigns ?? []).map(c => (
    c.status === 'running' ? { ...c, status: 'paused' as const, pauseReason: 'Restaurada de backup' } : c
  )))
  await saveAllTasks(b.tasks ?? [])
  await saveAllSendHistory(b.history ?? [])
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(v: string): string {
  return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export async function buildKanbanCsv(): Promise<string> {
  const [cards, columns] = await Promise.all([getKanbanCards(), getKanbanColumns()])
  const colName = new Map(columns.map(c => [c.id, c.title]))
  const header = ['Nome', 'Telefone', 'Coluna', 'Tags', 'Notas', 'Última mensagem']
  const rows = cards.map(c => [
    c.contactName, c.phone, colName.get(c.columnId) ?? '', c.tags.join(' | '), c.notes, c.lastMessage,
  ].map(csvCell).join(','))
  return '﻿' + [header.join(','), ...rows].join('\n')
}
