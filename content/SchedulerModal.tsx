/**
 * Agendar follow-up — abre no WhatsApp Web pelo menu UP.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Recurrence, ScheduledMessage, Template } from '../src/types'
import { sendToBackground } from '../src/types'
import { getSettings, getTemplates, getTodayLog } from '../src/storage'
import { formatPhone, normalizePhone } from '../src/phone'
import { extraVariables, renderTemplate } from '../src/templates'
import { C, R } from '../src/theme'
import {
  overlayStyle, modalStyle, labelStyle, inputStyle, primaryBtn, errorStyle, toLocalInput, quickTimes, okStyle,
} from '../src/ui'
import { Icon } from '../src/icons'
import type { CurrentContact } from './whatsapp-bridge'

interface Props {
  contact: CurrentContact | null
  onClose: () => void
}

const chip: React.CSSProperties = {
  background: C.accentSoft, color: C.brand, border: `1px solid ${C.accentLine}`, borderRadius: R.pill,
  fontSize: '11.5px', fontWeight: 700, padding: '4px 11px', fontFamily: 'inherit',
}

export function SchedulerModal({ contact, onClose }: Props) {
  const [name, setName] = useState(contact?.name ?? '')
  const [phoneRaw, setPhoneRaw] = useState(contact?.phone ? formatPhone(contact.phone) : '')
  const [message, setMessage] = useState('')
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [vars, setVars] = useState<Record<string, string>>({})
  const [when, setWhen] = useState(toLocalInput(Date.now() + 60 * 60_000))
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [autoSend, setAutoSend] = useState(true)
  const [templates, setTemplates] = useState<Template[]>([])
  const [usage, setUsage] = useState<{ count: number; limit: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      const [tpls, settings, log] = await Promise.all([getTemplates(), getSettings(), getTodayLog()])
      setTemplates(tpls)
      setUsage({ count: log.count, limit: settings.dailyLimit })
    })()
  }, [])

  const phone = normalizePhone(phoneRaw)
  const extras = useMemo(() => extraVariables(message), [message])
  const preview = useMemo(
    () => renderTemplate(message, { contactName: name, vars }),
    [message, name, vars]
  )

  function applyTemplate(id: string) {
    const t = templates.find(x => x.id === id)
    setTemplateId(t?.id)
    if (t) setMessage(t.body)
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('Informe o nome do contato.')
    if (!phone) return setError('Telefone inválido. Use DDD + número, ex.: (31) 99999-9999.')
    if (!message.trim()) return setError('Escreva a mensagem.')
    if (preview.missing.length > 0) {
      return setError(`Preencha: ${preview.missing.map(v => `{${v}}`).join(', ')}.`)
    }
    const scheduledAt = new Date(when).getTime()
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
      return setError('Escolha uma data e hora no futuro.')
    }

    setSaving(true)
    const now = Date.now()
    const msg: ScheduledMessage = {
      id: `msg_${now}_${Math.random().toString(36).slice(2)}`,
      contactName: name.trim(),
      phone,
      message: message.trim(),
      vars,
      templateId,
      autoSend,
      scheduledAt,
      recurrence,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }
    const reply = await sendToBackground({ type: 'SCHEDULE_MESSAGE', payload: msg })
    setSaving(false)
    if (!reply.ok) return setError(reply.message)
    setSaved(true)
    setTimeout(onClose, 1300)
  }

  const blocked = saving || saved

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Agendar follow-up" style={modalStyle(440)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', color: C.brand, fontWeight: 800, display: 'flex', alignItems: 'center', gap: '9px' }}>
            <Icon name="calendar" size={20} /> Agendar follow-up
          </h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label style={labelStyle}>
              Nome
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Nome do contato" />
            </label>
            <label style={labelStyle}>
              Telefone
              <input style={inputStyle} value={phoneRaw} onChange={e => setPhoneRaw(e.target.value)} placeholder="(31) 99999-9999" />
              <span style={{ fontSize: '11px', fontWeight: 600, color: phone ? C.ok : C.muted }}>
                {phone ? formatPhone(phone) : 'DDD + número'}
              </span>
            </label>
          </div>

          <label style={labelStyle}>
            Template (opcional)
            <select style={inputStyle} value={templateId ?? ''} onChange={e => applyTemplate(e.target.value)}>
              <option value="">Mensagem livre</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>

          <label style={labelStyle}>
            Mensagem
            <textarea
              style={{ ...inputStyle, minHeight: '88px', resize: 'vertical' }}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Use {primeiro_nome}, {data} ou suas próprias {variáveis}"
            />
          </label>

          {extras.map(v => (
            <label key={v} style={labelStyle}>
              {`{${v}}`}
              <input
                style={inputStyle}
                value={vars[v] ?? ''}
                onChange={e => setVars({ ...vars, [v]: e.target.value })}
                placeholder={`Valor para ${v}`}
              />
            </label>
          ))}

          {message.trim() && (
            <div style={{ background: C.accentSoft, border: `1px solid ${C.accentLine}`, borderRadius: R.md, padding: '10px 12px' }}>
              <div style={{ fontSize: '10.5px', color: C.brand, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>Prévia</div>
              <div style={{ fontSize: '13px', color: C.inkSoft, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{preview.text}</div>
            </div>
          )}

          <div>
            <div style={{ ...labelStyle, marginBottom: '6px' }}>Quando enviar</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {quickTimes().map(q => (
                <button key={q.label} type="button" style={chip} onClick={() => setWhen(toLocalInput(q.ts))}>{q.label}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '10px' }}>
              <input type="datetime-local" aria-label="Data e hora" style={inputStyle} value={when} onChange={e => setWhen(e.target.value)} />
              <select aria-label="Repetir" style={inputStyle} value={recurrence} onChange={e => setRecurrence(e.target.value as Recurrence)}>
                <option value="none">Não repetir</option>
                <option value="daily">Todo dia</option>
                <option value="weekly">Toda semana</option>
                <option value="monthly">Todo mês</option>
              </select>
            </div>
          </div>

          <label
            style={{
              display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', borderRadius: R.md, padding: '12px 14px',
              border: `1.5px solid ${autoSend ? C.accent : C.lineStrong}`, background: autoSend ? C.accentSoft : '#fff',
            }}
          >
            <input type="checkbox" checked={autoSend} onChange={e => setAutoSend(e.target.checked)} style={{ marginTop: '3px', accentColor: C.brand, width: '16px', height: '16px' }} />
            <span style={{ fontSize: '12.5px', color: C.inkSoft, lineHeight: 1.5 }}>
              <strong style={{ color: C.brand, display: 'flex', alignItems: 'center', gap: '6px' }}><Icon name="bot" size={15} /> Enviar sozinho</strong>
              O computador precisa estar ligado e o WhatsApp Web conectado. Desmarque para receber um aviso e confirmar com um clique.
            </span>
          </label>

          <p style={{ margin: 0, fontSize: '11.5px', color: C.muted, lineHeight: 1.5 }}>
            Se o navegador estiver fechado na hora, o item fica em “Vencidos” para você decidir; nada sai atrasado sozinho.
            {usage && ` Hoje: ${usage.count} de ${usage.limit} envios.`}
          </p>

          {error && <div role="alert" style={errorStyle}>{error}</div>}
          {saved && <div style={okStyle}>Follow-up agendado.</div>}

          <button style={{ ...primaryBtn(blocked), padding: '12px' }} onClick={handleSave} disabled={blocked}>
            {saving ? 'Salvando…' : saved ? 'Agendado' : <><Icon name="calendar" size={16} /> Agendar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
