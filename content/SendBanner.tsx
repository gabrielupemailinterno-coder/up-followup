/**
 * Banner de envio. Aparece quando o background abriu o chat por número.
 * - auto: envia sozinho após uma pequena pausa (com opção de cancelar);
 * - manual: só envia quando o usuário clica em "Enviar".
 */

import React, { useEffect, useState } from 'react'
import type { ActiveSend } from '../src/types'
import { sendToBackground } from '../src/types'
import { formatPhone } from '../src/phone'
import { C, FONT, R, SHADOW, brandUrl } from '../src/theme'
import { Icon } from '../src/icons'
import { clickSend, ensureText, randomBetween, waitForCompose } from './whatsapp-bridge'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'sending' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'done' }

const ERRORS: Record<string, string> = {
  INVALID_NUMBER: 'O WhatsApp informou que o número é inválido ou não está no WhatsApp.',
  LOAD_TIMEOUT: 'A conversa não carregou a tempo. Verifique a conexão do WhatsApp Web.',
  NOT_LOGGED_IN: 'O WhatsApp Web não está conectado (QR code na tela). Conecte e tente de novo.',
  RESTRICTED: 'O WhatsApp mostrou um aviso de restrição na conta. Envios pausados por segurança.',
}

export function SendBanner({ job, onFinish }: { job: ActiveSend; onFinish: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  /** Reporta o resultado e, em campanha, agenda o próximo item após o atraso aleatório. */
  async function report(payload: { ok: boolean; code?: string; message?: string }) {
    const reply = await sendToBackground<{ nextDelayMs?: number }>({ type: 'SEND_RESULT', payload: { id: job.id, ...payload } })
    const delay = reply.ok ? reply.data?.nextDelayMs : undefined
    if (job.campaignId && typeof delay === 'number') {
      const campaignId = job.campaignId
      setTimeout(() => { void sendToBackground({ type: 'CAMPAIGN_ADVANCE', payload: { id: campaignId } }) }, delay)
    }
  }

  async function doSend() {
    setPhase({ kind: 'sending' })
    const outcome = await clickSend()
    if (outcome.ok) {
      await report({ ok: true })
      setPhase({ kind: 'done' })
      setTimeout(onFinish, 2500)
    } else {
      await report({ ok: false, code: outcome.code, message: outcome.message })
      setPhase({ kind: 'error', code: outcome.code, message: outcome.message })
    }
  }

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      const state = await waitForCompose()
      if (!alive) return
      if (state.status === 'ready') {
        await ensureText(state.el, job.text)
        if (!alive) return
        setPhase({ kind: 'ready' })
        // Pausa curta e variável antes do envio automático (e para dar chance de cancelar).
        if (job.auto) timer = setTimeout(() => { if (alive) void doSend() }, randomBetween(2500, 5000))
        return
      }
      const code = { invalid: 'INVALID_NUMBER', timeout: 'LOAD_TIMEOUT', not_logged_in: 'NOT_LOGGED_IN', restricted: 'RESTRICTED' }[state.status]
      const message = ERRORS[code]
      await report({ ok: false, code, message })
      if (alive) setPhase({ kind: 'error', code, message })
    })()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job])

  async function cancel() {
    await report({ ok: false, code: 'CANCELLED' })
    onFinish()
  }

  const light: React.CSSProperties = { background: 'rgba(247,244,237,0.12)', border: '1px solid rgba(247,244,237,0.35)', color: C.onBrand }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 999999,
        background: `linear-gradient(135deg, ${C.inkSoft}, ${C.brand})`, color: C.onBrand, borderRadius: R.lg, padding: '14px 16px',
        boxShadow: SHADOW.pop, fontFamily: FONT, width: '460px', maxWidth: '92vw',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <img src={brandUrl('logo-up-offwhite.png')} alt="UP" style={{ height: '16px' }} />
        <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Icon name={job.auto ? 'bot' : 'hand'} size={13} /> {job.auto ? 'Envio automático' : 'Confirmar envio'}
        </span>
      </div>
      <div style={{ fontSize: '13.5px', fontWeight: 800 }}>
        {job.contactName} <span style={{ fontWeight: 500, opacity: 0.8 }}>· {formatPhone(job.phone)}</span>
      </div>
      <div style={{ fontSize: '12.5px', opacity: 0.92, whiteSpace: 'pre-wrap', maxHeight: '96px', overflow: 'auto', margin: '6px 0 12px', background: 'rgba(13,15,12,0.25)', borderRadius: R.sm, padding: '8px 10px', lineHeight: 1.45 }}>
        {job.text}
      </div>

      {phase.kind === 'loading' && <div style={{ fontSize: '12.5px', fontWeight: 600 }}>Abrindo a conversa…</div>}

      {phase.kind === 'ready' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {job.auto ? (
            <>
              <span style={{ fontSize: '12.5px', fontWeight: 600, flex: 1 }}>Enviando em instantes…</span>
              <button onClick={cancel} style={{ ...btn, ...light }}>Cancelar</button>
            </>
          ) : (
            <>
              <button onClick={doSend} style={{ ...btn, background: C.onBrand, color: C.brand }}><Icon name="send" size={15} /> Enviar</button>
              <button onClick={cancel} style={{ ...btn, ...light }}>Cancelar</button>
              <span style={{ fontSize: '11.5px', opacity: 0.8 }}>Confira o texto antes de enviar.</span>
            </>
          )}
        </div>
      )}

      {phase.kind === 'sending' && <div style={{ fontSize: '12.5px', fontWeight: 600 }}>Enviando…</div>}
      {phase.kind === 'done' && (
        <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '7px' }}>
          <Icon name="checkCircle" size={17} /> Enviado e registrado.
        </div>
      )}

      {phase.kind === 'error' && (
        <div>
          <div style={{ fontSize: '12.5px', background: '#6E2A1D', borderRadius: R.sm, padding: '8px 10px', marginBottom: '10px', display: 'flex', gap: '8px', alignItems: 'flex-start', lineHeight: 1.45 }}>
            <Icon name="alert" size={16} style={{ marginTop: '1px' }} /> {phase.message}
          </div>
          <button onClick={onFinish} style={{ ...btn, ...light }}>Fechar</button>
        </div>
      )}
    </div>
  )
}

const btn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: R.sm, border: 'none', fontSize: '13px', fontWeight: 800,
  fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '7px',
}
