/**
 * Adaptador do CRM Incbook (crm.incbook.com.br): opera a tela como uma pessoa faria.
 * Tudo o que depende do layout do CRM fica aqui; se o CRM mudar, só este arquivo precisa de ajuste.
 * Nunca lê nem usa credenciais: só a tela e as propriedades React dos cards.
 */

import type { CrmLead } from '../src/types'
import { normalizePhone } from '../src/phone'
import type { CrmPageAdapter, LeadHit } from '../src/crmDriver'

// ─── Seletores (únicos pontos sensíveis ao layout) ────────────────────────────

const SEL = {
  leadsSearch: 'input[placeholder*="Procurar" i]',
  funilSearch: 'input[placeholder*="Pesquisar pelo nome" i]',
  modal: '.ant-modal-content, .ant-drawer-content',
  modalClose: '.ant-modal-close, .ant-drawer-close, button[aria-label="Close"]',
  typeInput: '#idTipoAtividade',
  whenInput: '#quando',
  editor: '[contenteditable="true"].tiptap, .tiptap[contenteditable="true"], form [contenteditable="true"]',
  selectOption: '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
  confirmOk: '.ant-modal-confirm .ant-btn-primary, .ant-popconfirm .ant-btn-primary',
} as const

// ─── Utilidades ───────────────────────────────────────────────────────────────

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function waitFor<T>(fn: () => T | null | undefined | false, timeoutMs = 8000, stepMs = 150): Promise<T | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const v = fn()
    if (v) return v
    await sleep(stepMs)
  }
  return null
}

/** O CRM (React/antd) só reage à sequência completa de eventos do mouse. */
function realClick(el: Element) {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }))
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

function fiberOf(el: Element): AnyObj | null {
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber'))
  return key ? ((el as unknown as AnyObj)[key] as AnyObj) : null
}

/** Sobe a árvore React a partir de um elemento até achar props que satisfaçam `pick`. */
function climbProps<T>(el: Element, pick: (props: AnyObj) => T | null, max = 40): T | null {
  let f = fiberOf(el)
  for (let i = 0; i < max && f; i++, f = f.return) {
    const props = f.memoizedProps
    if (props && typeof props === 'object') {
      const hit = pick(props)
      if (hit) return hit
    }
  }
  return null
}

// ─── Leitura dos leads (somente leitura) ──────────────────────────────────────

/** /leads: lista de até 50 leads, com telefones. */
export function readLeadsArray(): AnyObj[] | null {
  const candidates = [...document.querySelectorAll('li, tr, [role="row"]')].slice(0, 8)
  for (const el of candidates) {
    const arr = climbProps(el, p => (Array.isArray(p.leads) && p.leads.length ? (p.leads as AnyObj[]) : null))
    if (arr) return arr
  }
  return null
}

const phoneStrings = (l: AnyObj): string[] =>
  ((l.telefones as unknown[]) ?? [])
    .map(t => (typeof t === 'string' ? t : String((t as AnyObj)?.numero ?? (t as AnyObj)?.telefone ?? '')))
    .filter(Boolean)

export function leadsFromLeadsPage(now = Date.now()): CrmLead[] {
  const arr = readLeadsArray() ?? []
  return arr
    .filter(l => typeof l.id === 'string' && typeof l.nome === 'string')
    .map(l => ({
      id: l.id as string,
      name: l.nome as string,
      phones: phoneStrings(l).map(p => normalizePhone(p)).filter((p): p is string => !!p),
      empreendimentos: ((l.empreendimentos as unknown[]) ?? []).map(e => String(typeof e === 'object' ? (e as AnyObj)?.nome ?? (e as AnyObj)?.id : e)),
      syncedAt: now,
    }))
}

const toTs = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(t) ? t : 0
}

function detailsButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter(b => /detalhes/i.test(b.textContent ?? '')) as HTMLButtonElement[]
}

function leadOfCard(btn: Element): AnyObj | null {
  return climbProps(btn, p => {
    for (const v of Object.values(p)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && 'nome' in v && 'etapa' in v) return v as AnyObj
    }
    return 'nome' in p && 'etapa' in p ? p : null
  })
}

/** /funil: cards com a etapa (entrada, última interação, corretor). Sem telefone. */
export function leadsFromFunilPage(now = Date.now()): CrmLead[] {
  const out: CrmLead[] = []
  for (const btn of detailsButtons()) {
    const l = leadOfCard(btn)
    if (!l || typeof l.id !== 'string') continue
    const e = (l.etapa ?? {}) as AnyObj
    const owner = e.usuario && typeof e.usuario === 'object' ? String((e.usuario as AnyObj).nome ?? '') : typeof e.usuario === 'string' ? e.usuario : ''
    out.push({
      id: l.id as string,
      name: String(l.nome ?? ''),
      phones: [],
      empreendimentos: [],
      stage: { order: Number(e.ordem ?? 0), enteredAt: toTs(e.createdAt), lastInteractionAt: toTs(e.referenciaInatividade), owner: owner || undefined },
      syncedAt: now,
    })
  }
  return out
}

// ─── Adaptador usado pelo executor ────────────────────────────────────────────

function findCardButton(leadId: string): HTMLButtonElement | null {
  for (const btn of detailsButtons()) {
    if (leadOfCard(btn)?.id === leadId) return btn
  }
  return null
}

const modalEl = () => document.querySelector(SEL.modal)

function activityForm(): HTMLFormElement | null {
  return document.querySelector<HTMLInputElement>(SEL.typeInput)?.closest('form') ?? null
}

function editorEl(): HTMLElement | null {
  return activityForm()?.querySelector<HTMLElement>(SEL.editor) ?? null
}

async function openSelect(input: HTMLElement): Promise<HTMLElement | null> {
  const select = input.closest<HTMLElement>('.ant-select')
  if (!select) return null
  realClick(select.querySelector('.ant-select-selector') ?? select)
  await sleep(400)
  return select
}

async function chooseOption(select: HTMLElement, match: (text: string) => boolean, query = ''): Promise<string[] | 'ok'> {
  const read = () => [...document.querySelectorAll<HTMLElement>(SEL.selectOption)]
  let options = read()
  let hit = options.find(o => match(o.textContent ?? ''))
  if (!hit && query) {
    // lista longa/virtualizada: filtra digitando o começo do texto (ex.: "4B")
    const search = select.querySelector<HTMLInputElement>('input')
    if (search) {
      setInputValue(search, query)
      await sleep(400)
      options = read()
      hit = options.find(o => match(o.textContent ?? ''))
    }
  }
  if (!hit) return options.map(o => (o.textContent ?? '').trim())
  realClick(hit)
  await sleep(300)
  return 'ok'
}

export function createCrmAdapter(): CrmPageAdapter {
  return {
    path: () => location.pathname.replace(/\/+$/, '') || '/',

    goto(path) {
      location.assign(path)
    },

    async searchLeadsByPhone(crmPhone) {
      const input = await waitFor(() => document.querySelector<HTMLInputElement>(SEL.leadsSearch), 10_000)
      if (!input) return []
      const sig = (arr: AnyObj[] | null) => (arr ?? []).map(l => l.id).join(',')
      const before = sig(readLeadsArray())
      setInputValue(input, crmPhone)
      // espera a lista mudar em relação à anterior (evita ler resultado velho)
      await waitFor(() => (sig(readLeadsArray()) !== before ? true : null), 7000, 250)
      await sleep(600)
      return (readLeadsArray() ?? []).map<LeadHit>(l => ({ id: String(l.id), name: String(l.nome ?? ''), phones: phoneStrings(l) }))
    },

    async openLeadCard(leadId, leadName) {
      const input = await waitFor(() => document.querySelector<HTMLInputElement>(SEL.funilSearch), 10_000)
      if (!input) return false
      let btn = findCardButton(leadId)
      if (!btn && leadName.trim().length >= 3) {
        setInputValue(input, leadName.trim())
        btn = await waitFor(() => findCardButton(leadId), 8000, 250)
      }
      if (!btn) return false
      realClick(btn)
      return !!(await waitFor(() => modalEl(), 6000))
    },

    readModalPhones() {
      const root = modalEl() ?? document
      return [...root.querySelectorAll<HTMLInputElement>('input[name^="telefone"]')].map(i => i.value).filter(Boolean)
    },

    async openActivityForm() {
      if (!document.querySelector(SEL.typeInput)) {
        const root = modalEl() ?? document
        const btn = [...root.querySelectorAll('button')].find(b => (b as HTMLButtonElement).type !== 'submit' && /^adicionar atividade$/i.test((b.textContent ?? '').trim()))
        if (!btn) return false
        realClick(btn)
      }
      return !!(await waitFor(() => document.querySelector(SEL.typeInput), 5000))
    },

    async selectActivityType(label) {
      const input = document.querySelector<HTMLElement>(SEL.typeInput)
      if (!input) return { ok: false }
      const select = await openSelect(input)
      if (!select) return { ok: false }
      const result = await chooseOption(select, t => norm(t) === norm(label), label.trim().split(/\s+/)[0])
      if (result === 'ok') {
        const chosen = norm(select.querySelector('.ant-select-selection-item')?.textContent ?? '')
        return chosen === norm(label) ? { ok: true } : { ok: false, available: ['(a seleção não foi confirmada na tela)'] }
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      return { ok: false, available: result }
    },

    async selectWhenNow() {
      const input = document.querySelector<HTMLElement>(SEL.whenInput)
      const select = input?.closest<HTMLElement>('.ant-select')
      if (!input || !select) return false
      if (select.querySelector('.ant-select-selection-item')) return true // já vem com valor
      const opened = await openSelect(input)
      if (!opened) return false
      const r = await chooseOption(opened, t => /agora|hoje|now/i.test(t))
      if (r === 'ok') return true
      const first = document.querySelector<HTMLElement>(SEL.selectOption)
      if (first) realClick(first)
      return !!first
    },

    async writeComment(text) {
      const ed = editorEl()
      if (!ed) return false
      ed.focus()
      document.execCommand('selectAll', false)
      document.execCommand('insertText', false, text)
      await sleep(300)
      return (ed.textContent ?? '').includes(text.slice(0, 20))
    },

    activityCount() {
      const root = modalEl() ?? document
      for (const b of root.querySelectorAll('button')) {
        const m = (b.textContent ?? '').trim().match(/^Todas\s*(\d+)$/i)
        if (m) return Number(m[1])
      }
      return null
    },

    async submit() {
      const btn = activityForm()?.querySelector<HTMLButtonElement>('button[type="submit"]')
      if (!btn) return false
      realClick(btn)
      return true
    },

    async waitForNewActivity(before) {
      const ok = await waitFor(() => {
        const now = this.activityCount()
        if (before !== null && now !== null && now > before) return true
        // sem contador: formulário reiniciou (editor vazio) depois do envio
        if (before === null) {
          const ed = editorEl()
          return ed && (ed.textContent ?? '').trim() === '' ? true : null
        }
        return null
      }, 9000, 300)
      return !!ok
    },

    async closeModal() {
      const btn = document.querySelector(SEL.modalClose)
      if (btn) realClick(btn)
      await sleep(600)
      // confirmação de "descartar alterações", se o CRM pedir
      const ok = document.querySelector(SEL.confirmOk)
      if (ok) {
        realClick(ok)
        await sleep(600)
      }
    },
  }
}
