/**
 * Content Script — injetado em web.whatsapp.com
 * Carrega a fonte da marca e monta a camada UP quando a interface principal do WA estiver pronta.
 */

import { FloatingButton } from './FloatingButton'
import { fontFaceCss } from '../src/theme'

/** @font-face precisa estar no documento principal (não funciona dentro do Shadow DOM). */
function injectFonts() {
  if (document.getElementById('wm-fonts')) return
  const style = document.createElement('style')
  style.id = 'wm-fonts'
  style.textContent = fontFaceCss(file => chrome.runtime.getURL(file))
  document.head.appendChild(style)
}

function mountOnce() {
  if (document.getElementById('wm-root')) return true
  if (!document.getElementById('app')) return false
  injectFonts()
  FloatingButton.mount()
  return true
}

function init() {
  // O #app pode já existir quando o script roda (document_idle): checa antes de observar.
  if (mountOnce()) return
  const observer = new MutationObserver(() => {
    if (mountOnce()) observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

init()
