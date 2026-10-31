/**
 * Painel UP dentro do CRM Incbook (abas normais, não a janela de trabalho).
 * Com um lead aberto: mostra os dados dele, pede 3 mensagens ao Gemini e envia/agenda pelo WhatsApp Web.
 */

import { createRoot } from 'react-dom/client'
import React from 'react'
import type { LeadContext, ScheduledMessage } from '../src/types'
import { sendToBackground } from '../src/types'
import { normalizePhone } from '../src/phone'
import { safeInterval } from '../src/alive'
import { BASE_CSS, C, FONT, R, SHADOW } from '../src/theme'
import { Icon } from '../src/icons'
import { errorStyle, ghostBtn, inputStyle, okStyle, primaryBtn, toLocalInput } from '../src/ui'
import { readLeadContext } from './crm-adapter'

export function mountCrmPanel() {
  if (document.getElementById('wm-crm-root')) return
  const host = document.createElement('div')
  host.id = 'wm-crm-root'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = BASE_CSS
  const container = document.createElement('div')
  container.style.fontFamily = FONT
  shadow.append(style, container)
  createRoot(container).render(React.createElement(CrmPanelApp))
}

const sameLead = (a: LeadContext | null, b: LeadContext | null) =>
  a?.name === b?.name && a?.phones.join() === b?.phones.join() && a?.stage === b?.stage && a?.activities === b?.activities

interface Suggestion { text: string; when: string; note?: { ok: boolean; text: string } }

function CrmPanelApp() {
  const [open, setOpen] = React.useState(false)
  const [lead, setLead] = React.useState<LeadContext | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [items, setItems] = React.useState<Suggestion[]>([])
  const [syncNote, setSyncNote] = React.useState<string | null>(null)

  React.useEffect(() => {
    const read = () => {
      if (document.hidden) return
      const l = readLeadContext()
      setLead(prev => (sameLead(prev, l) ? prev : l))
    }
    read()
    return safeInterval(read, 1500)
  }, [])

  // trocou de lead: as sugestões antigas não valem mais
  const leadKey = lead ? `${lead.name}|${lead.phones.join()}` : ''
  const [nameEdit, setNameEdit] = React.useState('')
  const [phoneEdit, setPhoneEdit] = React.useState('')
  React.useEffect(() => {
    setItems([]); setError(null)
    setNameEdit(lead?.name ?? '')
    setPhoneEdit(lead?.phones[0] ?? '')
  }, [leadKey])

  // o corretor pode corrigir nome e telefone se a leitura da tela errar
  const phone = normalizePhone(phoneEdit)

  async function suggest() {
    if (!lead) return
    setBusy(true); setError(null)
    const r = await sendToBackground<{ messages: string[] }>({ type: 'GEMINI_SUGGEST', payload: { lead: { ...lead, name: nameEdit.trim() || lead.name } } })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    const when = toLocalInput(Date.now() + 60 * 60_000)
    setItems((r.data?.messages ?? []).map(text => ({ text, when })))
  }

  function patch(i: number, p: Partial<Suggestion>) {
    setItems(list => list.map((x, j) => (j === i ? { ...x, ...p } : x)))
  }

  async function schedule(i: number, at: number) {
    if (!lead || !phone) return
    const now = Date.now()
    const msg: ScheduledMessage = {
      id: `msg_${now}_${Math.random().toString(36).slice(2)}`,
      contactName: nameEdit.trim() || lead.name || 'Lead',
      phone,
      message: items[i].text.trim(),
      vars: {},
      autoSend: true,
      scheduledAt: at,
      recurrence: 'none',
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }
    const r = await sendToBackground({ type: 'SCHEDULE_MESSAGE', payload: msg })
    patch(i, { note: r.ok
      ? { ok: true, text: at - now < 2 * 60_000 ? 'Na fila: sai pelo WhatsApp Web em instantes (deixe-o aberto). A atividade é registrada no CRM depois.' : `Agendado para ${new Date(at).toLocaleString('pt-BR')}.` }
      : { ok: false, text: r.message } })
  }

  function openWhatsApp(i: number) {
    if (!phone) return
    window.open(`https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(items[i].text.trim())}`, 'wm-whatsapp')
  }

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Abrir painel UP"
        title="Follow-up UP"
        style={{ position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483646, width: '52px', height: '52px', borderRadius: R.pill, border: 'none', background: C.brand, color: '#fff', fontWeight: 900, fontSize: '15px', boxShadow: SHADOW.pop, cursor: 'pointer' }}
      >
        UP
        {lead && !open && <span style={{ position: 'absolute', top: '4px', right: '4px', width: '10px', height: '10px', borderRadius: R.pill, background: C.accent, border: '2px solid #fff' }} />}
      </button>

      {open && (
        <aside style={{ position: 'fixed', right: '18px', bottom: '80px', zIndex: 2147483646, width: '380px', maxHeight: 'calc(100vh - 110px)', overflowY: 'auto', background: C.surface, color: C.ink, borderRadius: R.lg, boxShadow: SHADOW.pop, border: `1px solid ${C.line}`, padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <strong style={{ color: C.brand, fontSize: '14px', display: 'flex', gap: '7px', alignItems: 'center' }}><Icon name="chat" size={16} /> Mensagem para o lead</strong>
            <button onClick={() => setOpen(false)} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex', cursor: 'pointer' }}><Icon name="x" size={18} /></button>
          </div>

          {!lead && <p style={{ fontSize: '13px', color: C.muted, margin: 0 }}>Abra um lead no CRM (clique no nome dele) para sugerir e enviar mensagens.</p>}
          <button style={{ ...ghostBtn, width: '100%', marginBottom: '10px', marginTop: lead ? 0 : '10px' }} onClick={async () => {
            const r = await sendToBackground({ type: 'CRM_SYNC' })
            setError(r.ok ? null : r.message)
            setSyncNote(r.ok ? 'Sincronizando: uma janela do CRM abre, lê a tela Leads e atualiza o Kanban. O resultado aparece na aba CRM do ícone UP.' : null)
          }}><Icon name="repeat" size={14} /> Sincronizar com o Kanban</button>
          {syncNote && <div style={{ ...okStyle, marginBottom: '10px' }}>{syncNote}</div>}

          {lead && (
            <>
              <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px 12px', fontSize: '12.5px', lineHeight: 1.6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                  <input aria-label="Nome do lead" style={{ ...inputStyle, fontWeight: 700 }} value={nameEdit} placeholder="Nome" onChange={e => setNameEdit(e.target.value)} />
                  <input aria-label="Telefone do lead" style={inputStyle} value={phoneEdit} placeholder="(31) 99999-9999" onChange={e => setPhoneEdit(e.target.value)} />
                </div>
                {lead.phones.length > 1 && <div style={{ color: C.muted }}>Outros telefones: {lead.phones.slice(1).join(' · ')}</div>}
                <div style={{ color: C.muted }}>Etapa: {lead.stage ?? '?'} · Temperatura: {lead.temperature ?? '?'} · Atividades: {lead.activities ?? '?'}</div>
                <div style={{ color: C.muted }}>{[lead.persona && `Persona: ${lead.persona}`, lead.campaign && `Campanha: ${lead.campaign}`].filter(Boolean).join(' · ') || 'Persona/campanha não lidas (o Gemini lê o painel inteiro)'}</div>
              </div>
              {!phone && <div style={{ ...errorStyle, marginTop: '10px' }}>Telefone inválido: corrija o número acima para poder enviar.</div>}

              <button style={{ ...primaryBtn(busy || !phone), width: '100%', marginTop: '12px' }} disabled={busy || !phone} onClick={suggest}>
                <Icon name="bot" size={15} /> {busy ? 'Gemini pensando…' : items.length ? 'Sugerir outras 3' : 'Sugerir 3 mensagens com o Gemini'}
              </button>
              {error && <div style={{ ...errorStyle, marginTop: '10px' }}>{error}</div>}

              {items.map((it, i) => (
                <div key={i} style={{ marginTop: '12px', border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px' }}>
                  <textarea
                    aria-label={`Mensagem ${i + 1}`}
                    style={{ ...inputStyle, minHeight: '96px', resize: 'vertical', fontSize: '13px' }}
                    value={it.text}
                    onChange={e => patch(i, { text: e.target.value, note: undefined })}
                  />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    <button style={primaryBtn(!it.text.trim())} disabled={!it.text.trim()} onClick={() => void schedule(i, Date.now() + 5000)}><Icon name="send" size={14} /> Enviar agora</button>
                    <button style={ghostBtn} onClick={() => openWhatsApp(i)}><Icon name="chat" size={14} /> Abrir no WhatsApp</button>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                    <input type="datetime-local" aria-label="Data e hora" style={{ ...inputStyle, flex: 1 }} value={it.when} onChange={e => patch(i, { when: e.target.value })} />
                    <button
                      style={ghostBtn}
                      onClick={() => {
                        const at = new Date(it.when).getTime()
                        if (!Number.isFinite(at) || at <= Date.now()) return patch(i, { note: { ok: false, text: 'Escolha uma data e hora no futuro.' } })
                        void schedule(i, at)
                      }}
                    ><Icon name="calendar" size={14} /> Agendar</button>
                  </div>
                  {it.note && <div style={{ ...(it.note.ok ? okStyle : errorStyle), marginTop: '8px' }}>{it.note.text}</div>}
                </div>
              ))}
              <p style={{ fontSize: '11.5px', color: C.muted, margin: '10px 0 0', lineHeight: 1.5 }}>
                As sugestões usam os dados do lead na tela (etapa, persona, tags e atividades), enviados ao Gemini (Google). Revise antes de enviar.
              </p>
            </>
          )}
        </aside>
      )}
    </>
  )
}
