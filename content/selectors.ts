/**
 * Todos os seletores do DOM do WhatsApp Web ficam aqui.
 * Quando o WhatsApp mudar o layout, só este arquivo precisa de manutenção.
 * Cada entrada é uma lista de candidatos, do mais estável para o menos.
 */

export const SELECTORS = {
  composeBox: [
    '[data-testid="conversation-compose-box-input"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'footer div[contenteditable="true"]',
    '#main footer [contenteditable="true"]',
  ],
  sendButton: [
    '[data-testid="compose-btn-send"]',
    'footer button[aria-label="Enviar"]',
    'footer button[aria-label="Send"]',
    'footer span[data-icon="send"]',
  ],
  chatTitle: [
    '[data-testid="conversation-info-header-chat-title"]',
    '#main header span[title]',
    'header span[title]',
  ],
  dialog: ['div[role="dialog"]', '[data-animate-modal-popup="true"]'],
  messageWithJid: ['[data-id*="@c.us"]', '[data-id*="@s.whatsapp.net"]'],
  contactInfoHeader: [
    '#main [data-testid="conversation-info-header"]',
    '#main header [role="button"][tabindex="0"]',
  ],
  infoDrawer: ['[data-testid="chat-info-drawer"]'],
  qrCode: [
    '[data-testid="qrcode"]',
    'canvas[aria-label*="QR" i]',
    'div[data-ref] canvas',
  ],
} as const

export type SelectorKey = keyof typeof SELECTORS

export function queryFirst<T extends Element = HTMLElement>(key: SelectorKey, root: ParentNode = document): T | null {
  for (const sel of SELECTORS[key]) {
    const el = root.querySelector<T>(sel)
    if (el) return el
  }
  return null
}

/** Para diagnóstico: quais grupos de seletores não encontram nada na página atual. */
export function diagnose(): Record<SelectorKey, boolean> {
  const out = {} as Record<SelectorKey, boolean>
  for (const key of Object.keys(SELECTORS) as SelectorKey[]) out[key] = queryFirst(key) !== null
  return out
}
