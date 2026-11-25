/**
 * Campos do link em mensagem separada. Usado no agendamento e nas campanhas.
 */

import { useState } from 'react'
import type { MessageLink } from './types'
import { DEFAULT_LINK, MAX_LABEL, normalizeLink } from './link'
import { C, R } from './theme'
import { ghostBtn, primaryBtn, inputStyle, labelStyle, errorStyle, warnStyle } from './ui'
import { Icon } from './icons'

export function LinkFields({ value, onChange }: { value?: MessageLink; onChange: (link: MessageLink | undefined) => void }) {
  if (!value) {
    return (
      <div>
        <button type="button" style={ghostBtn} onClick={() => onChange({ ...DEFAULT_LINK })}>
          <Icon name="plus" size={14} /> Adicionar link com botão
        </button>
      </div>
    )
  }
  const set = (patch: Partial<MessageLink>) => onChange({ ...value, ...patch })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', border: `1px solid ${C.accentLine}`, borderRadius: R.md, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <strong style={{ fontSize: '12.5px', color: C.brand }}>Link em mensagem separada</strong>
        <button type="button" style={ghostBtn} onClick={() => onChange(undefined)}><Icon name="x" size={13} /> Remover link</button>
      </div>
      <label style={labelStyle}>
        Link
        <input style={inputStyle} value={value.url} onChange={e => set({ url: e.target.value })} placeholder="https://..." />
      </label>
      <label style={labelStyle}>
        Texto da segunda mensagem
        <input style={inputStyle} value={value.text} onChange={e => set({ text: e.target.value })} />
      </label>
      <label style={labelStyle}>
        Formato
        <select style={inputStyle} value={value.style} onChange={e => set({ style: e.target.value as MessageLink['style'] })}>
          <option value="button">Botão (experimental)</option>
          <option value="card">Cartão com a prévia do site</option>
        </select>
      </label>
      {value.style === 'button' && (
        <>
          <label style={labelStyle}>
            Nome do botão
            <input style={inputStyle} maxLength={MAX_LABEL} value={value.label} onChange={e => set({ label: e.target.value })} />
          </label>
          <div style={warnStyle}>
            O botão pode não aparecer em alguns celulares. Antes de usar com clientes, envie para outro número e confira.
          </div>
        </>
      )}
    </div>
  )
}

/** Versão com botão de salvar, para o card de uma campanha já criada. */
export function LinkEditor({ link, onSave }: { link?: MessageLink; onSave: (link: MessageLink | undefined) => void }) {
  const [draft, setDraft] = useState<MessageLink | undefined>(link)
  const [error, setError] = useState<string | null>(null)
  const changed = JSON.stringify(draft) !== JSON.stringify(link)

  function change(next: MessageLink | undefined) {
    setDraft(next)
    setError(null)
    if (!next && link) onSave(undefined)
  }

  function save() {
    if (!draft) return
    const r = normalizeLink(draft)
    if (!r.ok) return setError(r.error)
    setDraft(r.link)
    onSave(r.link)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <LinkFields value={draft} onChange={change} />
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {draft && changed && <div><button type="button" style={primaryBtn()} onClick={save}><Icon name="check" size={14} /> Salvar link</button></div>}
      {draft && changed && <span style={{ fontSize: '11.5px', fontWeight: 700, color: C.danger }}>Link ainda não salvo.</span>}
    </div>
  )
}
