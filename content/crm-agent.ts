/**
 * Piloto Gemini no CRM: lado da página. Tira o "retrato" da tela (texto + elementos clicáveis),
 * executa a ação que o código já validou (src/gemini.ts) e pergunta ao Gemini pelo segundo plano.
 * A chave do Gemini nunca passa por aqui: só o service worker a conhece.
 */

import type { CrmJob } from '../src/types'
import { sendToBackground } from '../src/types'
import { runAgentJob, type AgentDeps, type AgentOutcome } from '../src/agent'
import type { AgentAction, AgentElement, ElementKind, FormState, Snapshot } from '../src/gemini'
import type { CrmPageAdapter } from '../src/crmDriver'
import { leadRows, modalEl, readPhonesIn, realClick, setInputValue, sleep, waitFor } from './crm-adapter'

const MODAL_ROOTS = '.ant-modal-content, .ant-drawer-content'
const DROPDOWN = '.ant-select-dropdown:not(.ant-select-dropdown-hidden)'
const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [role="option"], [role="tab"], [role="combobox"], .ant-select-item-option, [contenteditable="true"]'
const MAX_ELEMENTS = 120

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n)

const activityForm = () => document.querySelector<HTMLInputElement>('#idTipoAtividade')?.closest('form') ?? null

function visible(el: Element): boolean {
  if (el.closest('#wm-driver-banner')) return false
  const style = getComputedStyle(el)
  return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none'
}

function labelOf(el: HTMLElement): string {
  const own = el.getAttribute('aria-label') || el.getAttribute('title') || ''
  if (own.trim()) return clip(own, 60)
  const formLabel = el.closest('.ant-form-item')?.querySelector('label')?.textContent ?? ''
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  if (isField) {
    if (formLabel.trim()) return clip(formLabel, 60)
    const ph = el.getAttribute('placeholder') || el.getAttribute('name') || el.id
    return clip(ph ?? '', 60)
  }
  const text = clip(el.textContent ?? '', 60)
  return text || clip(formLabel, 60)
}

function kindOf(el: HTMLElement): ElementKind | null {
  const form = activityForm()
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return form && form.contains(el) ? 'editor' : null
  if (el.matches('[role="option"], .ant-select-item-option')) return 'option'
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.matches('input[placeholder*="Procurar" i], input[placeholder*="Pesquisar" i]')) return 'search'
    if (el.closest('.ant-select')) return 'select-search'
    return 'input'
  }
  if (el.getAttribute('role') === 'tab') return 'tab'
  if (el instanceof HTMLAnchorElement) return el.getAttribute('href')?.startsWith('/') ? 'link' : null
  if (el instanceof HTMLButtonElement && el.type === 'submit') return form && form.contains(el) ? 'submit' : null   // outros "salvar" (dados do lead) ficam fora do retrato
  if (el.matches('.ant-modal-close, .ant-drawer-close, button[aria-label="Close"]')) return 'close'
  return 'button'
}

/** Elementos do retrato por id, para a execução localizar o que o modelo escolheu. */
let refs = new Map<number, HTMLElement>()

export function takeSnapshot(): Snapshot {
  const modals = [...document.querySelectorAll<HTMLElement>(MODAL_ROOTS)].filter(visible)
  const dropdowns = [...document.querySelectorAll<HTMLElement>(DROPDOWN)]
  const roots: ParentNode[] = modals.length ? [...modals, ...dropdowns] : [document.body]
  const seen = new Set<Element>()
  const elements: AgentElement[] = []
  refs = new Map()
  for (const root of roots) {
    for (const el of root.querySelectorAll<HTMLElement>(INTERACTIVE)) {
      if (seen.has(el) || !visible(el)) continue
      seen.add(el)
      const kind = kindOf(el)
      if (!kind) continue
      const label = labelOf(el) || (kind === 'editor' ? 'Comentário da atividade' : '')
      if (!label) continue           // ícone sem nome (ex.: ações da linha): fora do retrato, o modelo não consegue clicar
      const id = elements.length + 1
      const item: AgentElement = { id, kind, label }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { if (el.value) item.value = clip(el.value, 40) }
      if ((el as HTMLButtonElement).disabled) item.disabled = true
      if (kind === 'link') item.href = new URL((el as HTMLAnchorElement).href, location.origin).pathname
      if (kind === 'button' || kind === 'link') {
        const row = el.closest('tr')
        if (row) item.context = clip(row.textContent ?? '', 80)
      }
      elements.push(item)
      refs.set(id, el)
      if (elements.length >= MAX_ELEMENTS) break
    }
    if (elements.length >= MAX_ELEMENTS) break
  }

  const modal = modals[0] ?? null
  const phones = modal ? readPhonesIn(modal) : []
  const nameInput = modal?.querySelector<HTMLInputElement>('input[name="nome"], input[name="name"]')
  const firstText = modal ? [...modal.querySelectorAll<HTMLInputElement>('input[type="text"]')].find(i => i.value && !i.name.startsWith('telefone')) : undefined
  const scopeText = ((modal ?? document.body) as HTMLElement).innerText ?? ''
  return {
    path: location.pathname.replace(/\/+$/, '') || '/',
    title: document.title,
    modalOpen: !!modal,
    modalKey: nameInput?.value || firstText?.value || clip(modal?.textContent ?? '', 40),
    modalPhones: phones,
    rowCount: leadRows().length,
    text: clip(scopeText, 2500),
    elements,
  }
}

/** O que há sob o mouse em (x,y): sobe até o elemento interativo e o classifica como no retrato. */
function probeAt(x: number, y: number): AgentElement | null {
  const hit = document.elementFromPoint(x, y)
  const el = hit?.closest<HTMLElement>(INTERACTIVE)
  if (!el || !visible(el)) return null
  const kind = kindOf(el)
  const label = el ? (labelOf(el) || (kind === 'editor' ? 'Comentário da atividade' : '')) : ''
  if (!kind || !label) return null
  const item: AgentElement = { id: 1000, kind, label }
  if ((el as HTMLButtonElement).disabled) item.disabled = true
  if (kind === 'link') item.href = new URL((el as HTMLAnchorElement).href, location.origin).pathname
  refs.set(1000, el)
  return item
}

function formStateFor(job: Pick<CrmJob, 'comment'>): FormState {
  const typeInput = document.querySelector<HTMLElement>('#idTipoAtividade')
  const chosen = typeInput?.closest('.ant-select')?.querySelector('.ant-select-selection-item')?.textContent?.trim() || null
  const editor = activityForm()?.querySelector<HTMLElement>('[contenteditable="true"]')
  return {
    formOpen: !!typeInput,
    typeChosen: chosen,
    commentOk: !!editor && (editor.textContent ?? '').includes(job.comment.slice(0, 20)),
  }
}

async function perform(action: AgentAction, element: AgentElement | undefined, job: Pick<CrmJob, 'comment'>): Promise<void> {
  if (action.action === 'wait') { await sleep(1500); return }
  const el = element ? refs.get(element.id) : undefined
  if (!element || !el || !el.isConnected) throw new Error('o elemento escolhido saiu da tela')
  if (action.action === 'click' || action.action === 'click_at') {
    if (element.kind === 'select-search') realClick(el.closest('.ant-select')?.querySelector('.ant-select-selector') ?? el)
    else realClick(el)
    await sleep(700)
    return
  }
  // type
  if (element.kind === 'editor') {
    el.focus()
    document.execCommand('selectAll', false)
    document.execCommand('insertText', false, job.comment)
    await sleep(300)
  } else if (el instanceof HTMLInputElement) {
    setInputValue(el, action.text ?? '')
    await waitFor(() => (!document.querySelector('.ant-spin-spinning') ? true : null), 5000, 250)
    await sleep(element.kind === 'search' ? 1200 : 500)
  }
}

async function ask(system: string, prompt: string): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string }> {
  try {
    const r = await sendToBackground<{ text: string }>({ type: 'GEMINI_DECIDE', payload: { system, prompt, wantScreenshot: true } })
    if (r.ok && r.data?.text) return { ok: true, text: r.data.text }
    return r.ok ? { ok: false, code: 'empty', message: 'Resposta vazia do Gemini.' } : { ok: false, code: r.code, message: r.message }
  } catch (err) {
    return { ok: false, code: 'bridge', message: `Sem contato com o segundo plano: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function geminiReady(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await sendToBackground<{ configured: boolean; usedToday: number; limit: number }>({ type: 'GEMINI_STATUS' })
    if (!r.ok) return { ok: false, reason: r.message }
    if (!r.data?.configured) return { ok: false, reason: 'sem chave do Gemini' }
    if (r.data.usedToday >= r.data.limit) return { ok: false, reason: `limite diário do Gemini atingido (${r.data.limit})` }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'segundo plano indisponível' }
  }
}

export function runGeminiPilot(job: CrmJob, adapter: CrmPageAdapter, trace: (text: string) => void): Promise<AgentOutcome> {
  const deps: AgentDeps = {
    snapshot: async () => takeSnapshot(),
    ask,
    perform: (action, element) => perform(action, element, job),
    probe: probeAt,
    formState: () => formStateFor(job),
    closeModal: () => (modalEl() ? adapter.closeModal() : Promise.resolve()),
    activityCount: () => adapter.activityCount(),
    waitForNewActivity: before => adapter.waitForNewActivity(before),
    trace,
    sleep,
    now: () => Date.now(),
  }
  return runAgentJob(job, deps)
}
