/**
 * "Este número tem WhatsApp?": consulta pelo WA-JS, sob demanda (clique), para não perder tempo e
 * evitar mandar para número que não existe. Se o WA-JS não estiver disponível, só avisa.
 */

import { useEffect, useState } from 'react'
import { C } from '../src/theme'
import { explainWppError, wppCall } from '../src/wpp'

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'yes'; business: boolean }
  | { kind: 'no' }
  | { kind: 'unknown'; note: string }

export function WaCheck({ phone }: { phone: string | null }) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => { setState({ kind: 'idle' }) }, [phone])

  async function check() {
    if (!phone) return
    setState({ kind: 'checking' })
    const r = await wppCall<{ exists: boolean; isBusiness: boolean }>('queryExists', { phone }, 9000)
    if (!r.ok) setState({ kind: 'unknown', note: explainWppError(r.error) })
    else setState(r.data.exists ? { kind: 'yes', business: r.data.isBusiness } : { kind: 'no' })
  }

  if (!phone) return null
  const text: Record<State['kind'], string> = {
    idle: '', checking: 'Verificando no WhatsApp…', yes: '', no: '', unknown: '',
  }
  return (
    <span style={{ fontSize: '11px', fontWeight: 600, color: C.muted }}>
      {state.kind === 'idle' && (
        <button type="button" onClick={check} style={{ background: 'none', border: 'none', padding: 0, color: C.brand, fontWeight: 800, textDecoration: 'underline', fontSize: '11px' }}>
          Verificar se tem WhatsApp
        </button>
      )}
      {state.kind === 'checking' && text.checking}
      {state.kind === 'yes' && <span style={{ color: C.ok }}>✓ Tem WhatsApp{state.business ? ' (Business)' : ''}</span>}
      {state.kind === 'no' && <span style={{ color: C.danger }}>✗ Este número não tem WhatsApp</span>}
      {state.kind === 'unknown' && <span style={{ color: C.warn }}>Não consegui verificar: {state.note}</span>}
    </span>
  )
}
