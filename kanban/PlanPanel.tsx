/**
 * Aba "Claude": cola o código gerado pelo Claude, confere o que será criado, aplica
 * e salva o relatório para o Claude ler depois.
 */

import { useEffect, useState } from 'react'
import type { AppliedPlan } from '../src/types'
import { getAppliedPlans, STORAGE_KEYS as K } from '../src/storage'
import { watchStorage } from '../src/storageWatch'
import { applyPlan, checkPlan } from '../src/planStore'
import { downloadReport } from '../src/report'
import { formatWhen, type PlanResult } from '../src/plan'
import { C, R } from '../src/theme'
import { primaryBtn, ghostBtn, errorStyle, okStyle } from '../src/ui'
import { Icon } from '../src/icons'

const card: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '18px',
  display: 'flex', flexDirection: 'column', gap: '12px',
}
const h3: React.CSSProperties = { margin: 0, fontSize: '14px', fontWeight: 800, color: C.brand }

export function PlanPanel() {
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<PlanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<AppliedPlan[]>([])

  useEffect(() => {
    const load = () => { void getAppliedPlans().then(list => setApplied([...list].reverse())) }
    load()
    return watchStorage([K.APPLIED_PLANS], load, 200)
  }, [])

  async function run(task: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null)
    try {
      await task()
    } catch (e) {
      setError(`Algo deu errado: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const check = () => run(async () => setPreview(await checkPlan(code)))

  const apply = () => run(async () => {
    const result = await applyPlan(code)
    if (!result.ok) return setPreview(result)
    const file = await downloadReport()
    setPreview(null)
    setCode('')
    setMessage(`"${result.name}" aplicado. Relatório salvo (${file}), na pasta de downloads do Chrome.`)
  })

  const report = () => run(async () => {
    const file = await downloadReport()
    setMessage(`Relatório salvo (${file}), na pasta de downloads do Chrome ou onde você escolheu. Agora é só chamar /extensao no Claude.`)
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <section style={card}>
          <h3 style={h3}>Colar código do Claude</h3>
          <p style={{ margin: 0, fontSize: '13px', color: C.muted, lineHeight: 1.5 }}>
            Peça no Claude com <strong>/extensao</strong>, copie o código inteiro, cole aqui e confira antes de aplicar. Nada que já existe é apagado.
          </p>
          <textarea
            aria-label="Código do Claude"
            value={code}
            onChange={e => { setCode(e.target.value); setPreview(null); setMessage(null); setError(null) }}
            placeholder='{ "evler": 1, ... }'
            spellCheck={false}
            style={{ minHeight: '180px', resize: 'vertical', padding: '12px', borderRadius: R.sm, border: `1.5px solid ${C.line}`, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12px', color: C.ink, background: C.bg }}
          />
          <div>
            <button style={primaryBtn(busy || !code.trim())} disabled={busy || !code.trim()} onClick={() => void check()}>
              <Icon name="search" size={15} /> Conferir
            </button>
          </div>
        </section>

        {preview && !preview.ok && (
          <div role="alert" style={errorStyle}>
            <strong>Nada foi gravado. Corrija com o Claude:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>{preview.errors.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        {preview?.ok && (
          <section style={card} aria-label="Prévia">
            <h3 style={h3}>{preview.name}: o que será feito</h3>
            {preview.warnings.map(w => (
              <div key={w} role="alert" style={{ ...errorStyle, display: 'flex', gap: '8px' }}><Icon name="alert" size={16} /> {w}</div>
            ))}
            {preview.sections.map(s => (
              <div key={s.title}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: C.inkSoft, marginBottom: '4px' }}>{s.title}</div>
                <div style={{ fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto' }}>
                  {s.lines.map((l, i) => <div key={i} style={l.startsWith('  ') ? { color: C.muted, paddingLeft: '14px' } : undefined}>{l.trim()}</div>)}
                </div>
              </div>
            ))}
            {preview.skipped.length > 0 && (
              <div style={{ fontSize: '12px', color: C.muted, lineHeight: 1.6 }}>
                <strong>Já existia e não muda:</strong>
                {preview.skipped.map((s, i) => <div key={i}>{s}</div>)}
              </div>
            )}
            {preview.total === 0
              ? <div style={okStyle}>Não há nada novo para aplicar: tudo deste código já existe.</div>
              : (
                <div>
                  <button style={primaryBtn(busy)} disabled={busy} onClick={() => void apply()}>
                    <Icon name="check" size={15} /> {busy ? 'Aplicando…' : 'Aplicar'}
                  </button>
                </div>
              )}
          </section>
        )}

        {error && <div role="alert" style={errorStyle}>{error}</div>}
        {message && <div role="status" style={okStyle}>{message}</div>}

        <section style={card}>
          <h3 style={h3}>Relatório para o Claude</h3>
          <p style={{ margin: 0, fontSize: '13px', color: C.muted, lineHeight: 1.5 }}>
            Mostra quadros, etapas, campanhas e agendamentos, sem telefones. Salve antes de chamar /extensao para o Claude ver a situação de agora.
          </p>
          <div>
            <button style={ghostBtn} disabled={busy} onClick={() => void report()}><Icon name="download" size={15} /> Enviar relatório ao Claude</button>
          </div>
          {applied.length > 0 && (
            <div style={{ fontSize: '12px', lineHeight: 1.7 }}>
              <strong>Últimos códigos aplicados</strong>
              {applied.slice(0, 8).map(a => <div key={`${a.id}-${a.appliedAt}`}>{formatWhen(a.appliedAt)} · {a.name}</div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
