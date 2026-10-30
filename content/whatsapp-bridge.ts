/**
 * WhatsApp Web DOM Bridge
 * Único ponto que lê/escreve no DOM do WhatsApp. Seletores em selectors.ts.
 */

import { queryFirst } from './selectors'
import { phoneFromText } from '../src/phone'

export interface CurrentContact {
  name: string
  phone?: string
}

/** Contato da conversa aberta. O telefone só aparece quando o WA o expõe no DOM. */
export function getCurrentContact(): CurrentContact | null {
  const header = queryFirst('chatTitle')
  if (!header) return null
  const name = (header.getAttribute('title') || header.textContent || '').trim()
  if (!name) return null

  // Contato não salvo: o título já é o número.
  let phone = phoneFromText(name) ?? undefined

  // Conversas 1:1 trazem o JID nas mensagens: data-id="true_5531999999999@c.us_ABC…"
  if (!phone) {
    const msg = queryFirst('messageWithJid', document.querySelector('#main') ?? document)
    const m = msg?.getAttribute('data-id')?.match(/_(\d{10,15})@c\.us/)
    if (m) phone = m[1]
  }
  return { name, phone }
}

export type ComposeState =
  | { status: 'ready'; el: HTMLElement }
  | { status: 'invalid' }
  | { status: 'restricted' }
  | { status: 'not_logged_in' }
  | { status: 'timeout' }

const INVALID_RE = /inv[aá]lid|n[aã]o est[aá] no whatsapp|not on whatsapp|isn.?t on whatsapp/i
const RESTRICTED_RE = /conta (est[aá] )?(restrita|bloqueada|banida)|restri[cç][aã]o (na|da) (sua )?conta|account (is )?(restricted|banned|blocked)|temporarily banned|banido temporariamente/i

function dialogText(): string {
  return queryFirst('dialog')?.textContent ?? ''
}

export const hasInvalidNumberDialog = () => INVALID_RE.test(dialogText())
export const hasRestrictionDialog = () => RESTRICTED_RE.test(dialogText())

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export const randomBetween = (minMs: number, maxMs: number) => minMs + Math.random() * (maxMs - minMs)

/**
 * Espera o campo de texto (ou um estado de erro) aparecer.
 * Usa MutationObserver: diferente de timers, não é limitado quando a aba está em segundo plano.
 */
export function waitForCompose(timeoutMs = 45_000): Promise<ComposeState> {
  return new Promise(resolve => {
    const startedAt = Date.now()
    let qrSince = 0
    let observer: MutationObserver | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let settled = false

    function finish(state: ComposeState) {
      if (settled) return
      settled = true
      observer?.disconnect()
      if (timer) clearInterval(timer)
      resolve(state)
    }

    function check() {
      if (hasInvalidNumberDialog()) return finish({ status: 'invalid' })
      if (hasRestrictionDialog()) return finish({ status: 'restricted' })
      const el = queryFirst('composeBox')
      if (el) return finish({ status: 'ready', el })
      if (queryFirst('qrCode')) {
        qrSince = qrSince || Date.now()
        if (Date.now() - qrSince >= 6000) return finish({ status: 'not_logged_in' })
      } else {
        qrSince = 0
      }
      if (Date.now() - startedAt >= timeoutMs) finish({ status: 'timeout' })
    }

    observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    timer = setInterval(check, 1000)
    check()
  })
}

/** Garante que o campo contém o texto. O WA normalmente preenche via ?text=; isto é só reserva. */
export async function ensureText(el: HTMLElement, text: string): Promise<void> {
  await sleep(1200) // dá tempo do WA preencher o ?text=
  if ((el.textContent ?? '').trim().length > 0) return
  el.focus()
  document.execCommand('insertText', false, text)
}

/** Substitui todo o conteúdo do campo de mensagem (respostas rápidas). */
export function replaceComposeText(el: HTMLElement, text: string) {
  el.focus()
  document.execCommand('selectAll', false)
  document.execCommand('insertText', false, text)
}

export function isComposeTarget(target: EventTarget | null): boolean {
  const box = queryFirst('composeBox')
  return !!box && target instanceof Node && (target === box || box.contains(target))
}

export type SendOutcome = { ok: true } | { ok: false; code: string; message: string }

/** Clica no botão enviar e confirma que o campo esvaziou. */
export async function clickSend(): Promise<SendOutcome> {
  const target = queryFirst('sendButton')
  if (!target) {
    return { ok: false, code: 'SEND_BUTTON_NOT_FOUND', message: 'Botão de enviar não encontrado (layout do WhatsApp mudou?).' }
  }
  ;(target.closest('button') ?? target).click()

  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    await sleep(400)
    if (hasRestrictionDialog()) {
      return { ok: false, code: 'RESTRICTED', message: 'O WhatsApp mostrou um aviso de restrição na conta.' }
    }
    const box = queryFirst('composeBox')
    if (!box || (box.textContent ?? '').trim() === '') return { ok: true }
  }
  return { ok: false, code: 'SEND_NOT_CONFIRMED', message: 'Não foi possível confirmar o envio. Confira a conversa antes de reenviar.' }
}
