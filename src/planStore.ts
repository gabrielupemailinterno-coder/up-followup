/** Lê o estado atual, confere o código do Claude e grava as mudanças. */

import { sendToBackground } from './types'
import {
  addAppliedPlan, ensureSchema, getBoards, getCampaigns, getKanbanCards, getKanbanColumns,
  getScheduledMessages, getSettings, getTasks, getTemplates, saveBoards, saveCampaign,
  saveAllKanbanCards, saveKanbanColumns, saveSettings, saveTemplates,
} from './storage'
import { buildPlan, type PlanResult, type PlanState } from './plan'

export async function loadPlanState(): Promise<PlanState> {
  await ensureSchema()
  const [boards, campaigns, schedules, templates, tasks, settings] = await Promise.all([
    getBoards(), getCampaigns(), getScheduledMessages(), getTemplates(), getTasks(), getSettings(),
  ])
  const columns: PlanState['columns'] = {}
  const cards: PlanState['cards'] = {}
  for (const b of boards) {
    columns[b.id] = await getKanbanColumns(b.id)
    cards[b.id] = await getKanbanCards(b.id)
  }
  return { boards, columns, cards, campaigns, schedules, templates, tasks, settings }
}

export async function checkPlan(code: string): Promise<PlanResult> {
  return buildPlan(code, await loadPlanState())
}

/** Confere de novo com os dados do momento e só então grava. Com erro, nada é gravado. */
export async function applyPlan(code: string): Promise<PlanResult> {
  const plan = buildPlan(code, await loadPlanState())
  if (!plan.ok || plan.total === 0) return plan
  const c = plan.changes

  // Etapas e cards antes do quadro aparecer na lista, para ele nunca surgir vazio.
  for (const [id, cols] of Object.entries(c.columns)) await saveKanbanColumns(cols, id)
  for (const [id, cards] of Object.entries(c.cards)) await saveAllKanbanCards(cards, id)
  if (c.boards) await saveBoards(c.boards)
  for (const campaign of c.campaigns) await saveCampaign(campaign)
  if (c.templates) await saveTemplates(c.templates)
  if (c.settings) await saveSettings({ ...await getSettings(), ...c.settings })
  // Pelo segundo plano, que cria os alarmes.
  for (const msg of c.schedules) {
    const r = await sendToBackground({ type: 'SCHEDULE_MESSAGE', payload: msg })
    if (!r.ok) throw new Error(r.message)
  }
  for (const task of c.tasks) {
    const r = await sendToBackground({ type: 'TASK_SAVE', payload: task })
    if (!r.ok) throw new Error(r.message)
  }

  await addAppliedPlan({
    id: plan.id,
    name: plan.name,
    appliedAt: Date.now(),
    summary: plan.sections.map(s => `${s.title}: ${s.lines.filter(l => !l.startsWith('  ')).length}`),
  })
  return plan
}
