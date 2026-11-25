/**
 * Link enviado em uma mensagem separada, logo depois da principal:
 * como botão (experimental) ou como cartão com a prévia do site.
 */

import type { MessageLink } from './types'

export const DEFAULT_LINK: MessageLink = {
  url: '',
  text: 'Separei este link para você:',
  style: 'button',
  label: 'Ver agora',
}

export const MAX_LABEL = 25

/** Confere e arruma o link (completa o https://). */
export function normalizeLink(link: MessageLink): { ok: true; link: MessageLink } | { ok: false; error: string } {
  let url = link.url.trim()
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`
  if (!/^https?:\/\/[^\s/]+\.[^\s]{2,}$/i.test(url)) return { ok: false, error: 'Link inválido. Exemplo: https://www.evler.com.br' }
  const text = link.text.trim()
  if (!text) return { ok: false, error: 'Escreva o texto da mensagem do link.' }
  const label = link.label.trim()
  if (link.style === 'button' && !label) return { ok: false, error: 'Dê um nome ao botão.' }
  if (label.length > MAX_LABEL) return { ok: false, error: `O nome do botão pode ter até ${MAX_LABEL} letras.` }
  if (/\{[^}]*\}/.test(text + label)) return { ok: false, error: 'O texto e o botão do link não aceitam {variáveis}.' }
  return { ok: true, link: { url, text, style: link.style, label } }
}

export function describeLink(link: MessageLink): string {
  const kind = link.style === 'button' ? `botão "${link.label}"` : 'cartão com prévia'
  return `Segunda mensagem (${kind}): ${link.text} ${link.url}`
}
