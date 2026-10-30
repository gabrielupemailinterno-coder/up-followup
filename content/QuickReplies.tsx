/**
 * Respostas rápidas: digitar "/" no campo de mensagem lista os templates.
 * Setas navegam, Enter/Tab inserem, Esc fecha.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Template } from '../src/types'
import { getTemplates, STORAGE_KEYS as K } from '../src/storage'
import { watchStorage } from '../src/storageWatch'
import { renderTemplate } from '../src/templates'
import { C, FONT, R, SHADOW } from '../src/theme'
import { Icon } from '../src/icons'
import { queryFirst } from './selectors'
import { isComposeTarget, replaceComposeText, type CurrentContact } from './whatsapp-bridge'

export function QuickReplies({ getContact }: { getContact: () => CurrentContact | null }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const [pos, setPos] = useState({ left: 0, bottom: 0, width: 360 })
  const stateRef = useRef({ query, sel, matches: [] as Template[] })

  useEffect(() => {
    const load = () => { void getTemplates().then(setTemplates) }
    load()
    return watchStorage([K.TEMPLATES], load, 400)
  }, [])

  const matches = useMemo(() => {
    if (query === null) return []
    const q = query.toLowerCase()
    return templates.filter(t => `${t.title} ${t.body}`.toLowerCase().includes(q)).slice(0, 8)
  }, [query, templates])

  stateRef.current = { query, sel, matches }

  function insert(t: Template) {
    const box = queryFirst('composeBox')
    if (!box) return
    const contact = getContact()
    const vars: Record<string, string> = {}
    let result = renderTemplate(t.body, { contactName: contact?.name ?? '', vars })
    // Variáveis sem valor (extras ou nome ausente) viram pergunta rápida.
    for (const key of result.missing) {
      const answer = window.prompt(`Valor para {${key}}:`)
      if (answer === null) { setQuery(null); return }
      vars[key] = answer
    }
    if (result.missing.length > 0) {
      result = renderTemplate(t.body, { contactName: contact?.name ?? '', vars: { ...vars, nome: vars.nome ?? contact?.name ?? '' } })
    }
    replaceComposeText(box, result.text)
    setQuery(null)
  }

  useEffect(() => {
    const onInput = (e: Event) => {
      if (!isComposeTarget(e.target)) return
      const box = queryFirst('composeBox')
      if (!box) return
      const m = (box.textContent ?? '').match(/^\/(\S*)$/)
      if (!m) return setQuery(null)
      const r = box.getBoundingClientRect()
      setPos({ left: r.left, bottom: window.innerHeight - r.top + 8, width: Math.min(Math.max(r.width, 280), 520) })
      setQuery(m[1])
      setSel(0)
    }
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current
      if (s.query === null || s.matches.length === 0 || !isComposeTarget(e.target)) return
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSel((s.sel + 1) % s.matches.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s.sel - 1 + s.matches.length) % s.matches.length) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); insert(s.matches[s.sel]) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null) }
    }
    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (query === null || matches.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, zIndex: 999998,
        background: C.surface, borderRadius: R.md, boxShadow: SHADOW.pop, border: `1px solid ${C.line}`,
        fontFamily: FONT, overflow: 'hidden', color: C.ink,
      }}
    >
      <div style={{ padding: '8px 12px', fontSize: '11px', color: C.onBrand, background: C.brand, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '7px' }}>
        <Icon name="zap" size={13} /> Respostas rápidas
        <span style={{ marginLeft: 'auto', opacity: 0.75, fontWeight: 500 }}>↑↓ navegar · Enter inserir · Esc fechar</span>
      </div>
      {matches.map((t, i) => (
        <div
          key={t.id}
          onMouseDown={e => { e.preventDefault(); insert(t) }}
          style={{ padding: '9px 12px', cursor: 'pointer', background: i === sel ? C.accentSoft : C.surface, borderTop: `1px solid ${C.line}` }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700 }}>{t.title}</div>
          <div style={{ fontSize: '12px', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.body}
          </div>
        </div>
      ))}
    </div>
  )
}
