/**
 * Cliente (mundo isolado da extensão) da ponte com o WA-JS, que roda na página do WhatsApp Web.
 * Tudo aqui é opcional: se o WA-JS não estiver disponível, quem chama usa o método antigo (plano B).
 */

import { normalizePhone } from './phone'

export type WppResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface WppStatus {
  loaded: boolean
  version: string | null
  waVersion: string | null
  ready: boolean
  authenticated: boolean | null
  mainReady: boolean | null
  analyticsDisabled: boolean | null
  linkPreviewServers: number | null
}

export interface ActiveChatInfo {
  kind: 'user' | 'lid' | 'group' | 'other'
  phone: string | null
}

let seq = 0

/** Chama um método (da lista curta de leitura) da ponte. Nunca lança: erro e tempo esgotado viram { ok: false }. */
export function wppCall<T = unknown>(method: string, args?: unknown, timeoutMs = 4000): Promise<WppResult<T>> {
  return new Promise(resolve => {
    const id = `wm_${Date.now()}_${seq++}`
    let timer: ReturnType<typeof setTimeout> | undefined

    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window) return
      const d = ev.data as { source?: string; id?: string; ok?: boolean; data?: T; error?: string } | null
      if (!d || d.source !== 'wm-page' || d.id !== id) return
      cleanup()
      resolve(d.ok ? { ok: true, data: d.data as T } : { ok: false, error: String(d.error ?? 'erro') })
    }
    function cleanup() {
      window.removeEventListener('message', onMessage)
      if (timer) clearTimeout(timer)
    }

    timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: 'timeout' }) }, timeoutMs)
    window.addEventListener('message', onMessage)
    window.postMessage({ source: 'wm-ext', id, method, args }, '*')
  })
}

/** Resposta do getActiveChat -> telefone normalizado (E.164) ou indicação de grupo. */
export function interpretActiveChat(r: WppResult<ActiveChatInfo | null>): { phone: string | null; isGroup: boolean; answered: boolean } {
  if (!r.ok || !r.data) return { phone: null, isGroup: false, answered: false }
  if (r.data.kind === 'group') return { phone: null, isGroup: true, answered: true }
  const phone = r.data.phone ? normalizePhone(r.data.phone) : null
  return { phone, isGroup: false, answered: true }
}

/** Texto em português para um código de erro da ponte. */
export function explainWppError(error: string): string {
  switch (error) {
    case 'timeout':
    case 'wpp_not_loaded':
    case 'wpp_not_ready':
      return 'O WA-JS ainda não está pronto nesta página (espere o WhatsApp carregar ou dê F5).'
    case 'analytics_not_disabled':
      return 'Bloqueado por segurança: o rastreamento do WA-JS não está desligado.'
    case 'query_cap_reached':
      return 'Limite de consultas desta sessão atingido. Dê F5 para reiniciar.'
    case 'invalid_phone':
      return 'Telefone inválido para consulta.'
    default:
      return error
  }
}
