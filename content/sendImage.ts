/**
 * Envios pela ponte do WA-JS (imagem com legenda e link em mensagem separada),
 * só para a conversa que está aberta e confere com o telefone do envio.
 */

import type { ActiveSend } from '../src/types'
import { getImage } from '../src/images'
import { phoneKey } from '../src/groupImport'
import { explainWppError, interpretActiveChat, wppCall, type ActiveChatInfo } from '../src/wpp'
import { hasRestrictionDialog, type SendOutcome } from './whatsapp-bridge'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const fail = (code: string, message: string): SendOutcome => ({ ok: false, code, message })

/** A caixa de texto aparece antes de o WA-JS ficar pronto: espera a conversa certa. */
async function waitForChat(phone: string, timeoutMs = 25_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  let last = 'timeout'
  do {
    const r = await wppCall<ActiveChatInfo | null>('getActiveChat', undefined, 4000)
    const info = interpretActiveChat(r)
    if (info.phone && phoneKey(info.phone) === phoneKey(phone)) return null
    last = r.ok ? 'wrong_chat' : r.error
    await sleep(700)
  } while (Date.now() < deadline)
  return last
}

export async function sendImage(job: ActiveSend): Promise<SendOutcome> {
  const image = job.imageId ? await getImage(job.imageId) : undefined
  if (!image) return fail('NO_IMAGE', 'A imagem deste envio não foi encontrada. Anexe de novo.')

  const notReady = await waitForChat(job.phone)
  if (notReady) return fail('IMAGE_NOT_SENT', `Imagem não enviada. ${explainWppError(notReady)}`)

  // Uma única tentativa: sem confirmação, não reenviar sozinho (evita mensagem duplicada).
  const r = await wppCall('sendImage', { phone: job.phone, dataUrl: image.dataUrl, caption: job.text }, 60_000)
  if (hasRestrictionDialog()) return fail('RESTRICTED', 'O WhatsApp mostrou um aviso de restrição na conta.')
  if (r.ok) return { ok: true }
  if (r.error === 'timeout') return fail('SEND_NOT_CONFIRMED', 'Não foi possível confirmar o envio da imagem. Confira a conversa antes de reenviar.')
  return fail('IMAGE_NOT_SENT', `Imagem não enviada: ${explainWppError(r.error)}`)
}

/** Segunda mensagem com o link. A principal já saiu: quem chama não pode reenviá-la. */
export async function sendLink(job: ActiveSend): Promise<SendOutcome> {
  if (!job.link) return { ok: true }
  const prefix = 'A mensagem foi enviada, mas o link não'
  const notReady = await waitForChat(job.phone)
  if (notReady) return fail('LINK_NOT_SENT', `${prefix}. ${explainWppError(notReady)}`)
  const r = await wppCall('sendLink', { phone: job.phone, ...job.link }, 60_000)
  if (hasRestrictionDialog()) return fail('RESTRICTED', 'O WhatsApp mostrou um aviso de restrição na conta.')
  if (r.ok) return { ok: true }
  if (r.error === 'timeout') return fail('LINK_NOT_SENT', 'A mensagem foi enviada, mas não foi possível confirmar o link. Confira a conversa.')
  return fail('LINK_NOT_SENT', `${prefix}: ${explainWppError(r.error)}`)
}
