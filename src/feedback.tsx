/**
 * Feedback para as páginas da extensão (Kanban/Config): avisos (toast), confirmações e perguntas
 * no padrão visual UP, no lugar dos alert/confirm/prompt do navegador.
 */

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { C, FONT, R, SHADOW } from './theme'
import { dangerBtn, ghostBtn, inputStyle, labelStyle, modalStyle, overlayStyle, primaryBtn } from './ui'
import { Icon } from './icons'

type ToastKind = 'ok' | 'err' | 'info'

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
}

interface PromptOptions {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
}

interface Feedback {
  toast: (message: string, kind?: ToastKind) => void
  confirm: (o: ConfirmOptions) => Promise<boolean>
  prompt: (o: PromptOptions) => Promise<string | null>
}

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | null

const Ctx = createContext<Feedback | null>(null)

export function useFeedback(): Feedback {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFeedback fora do FeedbackProvider')
  return ctx
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([])
  const [dialog, setDialog] = useState<DialogState>(null)
  const nextId = useRef(1)

  const toast = useCallback((message: string, kind: ToastKind = 'ok') => {
    const id = nextId.current++
    setToasts(t => [...t, { id, message, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800)
  }, [])

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>(resolve => setDialog({ kind: 'confirm', opts, resolve })),
    []
  )
  const prompt = useCallback(
    (opts: PromptOptions) => new Promise<string | null>(resolve => setDialog({ kind: 'prompt', opts, resolve })),
    []
  )

  const value = useMemo(() => ({ toast, confirm, prompt }), [toast, confirm, prompt])

  return (
    <Ctx.Provider value={value}>
      {children}

      <div aria-live="polite" style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 1000001, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderRadius: R.md,
              background: C.brand, color: C.onBrand, fontSize: '13px', fontWeight: 600, fontFamily: FONT,
              boxShadow: SHADOW.pop, borderLeft: `4px solid ${t.kind === 'err' ? '#E08A74' : t.kind === 'info' ? '#9FB6C4' : C.accent}`,
            }}
          >
            <Icon name={t.kind === 'err' ? 'alert' : t.kind === 'info' ? 'info' : 'checkCircle'} size={16} />
            {t.message}
          </div>
        ))}
      </div>

      {dialog && <DialogView state={dialog} close={() => setDialog(null)} />}
    </Ctx.Provider>
  )
}

function DialogView({ state, close }: { state: NonNullable<DialogState>; close: () => void }) {
  const [value, setValue] = useState(state.kind === 'prompt' ? state.opts.initial ?? '' : '')

  function cancel() {
    if (state.kind === 'confirm') state.resolve(false)
    else state.resolve(null)
    close()
  }
  function ok() {
    if (state.kind === 'confirm') state.resolve(true)
    else {
      const v = value.trim()
      if (!v) return
      state.resolve(v)
    }
    close()
  }

  return (
    <div style={{ ...overlayStyle, zIndex: 1000000 }} onClick={e => e.target === e.currentTarget && cancel()}
      onKeyDown={e => { if (e.key === 'Escape') cancel() }}>
      <div role="dialog" aria-modal="true" aria-label={state.opts.title} style={modalStyle(400)}>
        <h2 style={{ margin: '0 0 8px', fontSize: '16px', color: C.brand }}>{state.opts.title}</h2>
        {state.kind === 'confirm' && state.opts.message && (
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.inkSoft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{state.opts.message}</p>
        )}
        {state.kind === 'prompt' && (
          <label style={{ ...labelStyle, margin: '8px 0 16px' }}>
            {state.opts.label}
            <input
              autoFocus
              style={inputStyle}
              value={value}
              placeholder={state.opts.placeholder}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') ok() }}
            />
          </label>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={ghostBtn} onClick={cancel}>Cancelar</button>
          <button
            style={state.kind === 'confirm' && state.opts.danger ? { ...dangerBtn, fontWeight: 700 } : primaryBtn()}
            onClick={ok}
            autoFocus={state.kind === 'confirm'}
          >
            {state.opts.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
