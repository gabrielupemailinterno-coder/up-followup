/**
 * Painel lateral do contato: mostra e edita, sem sair do WhatsApp, o card do Kanban
 * da conversa aberta (etapa, tags, notas), follow-ups pendentes e tarefas.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { KanbanCard, KanbanColumn, ScheduledMessage, Task } from '../src/types'
import { sendToBackground } from '../src/types'
import {
  applyColumnChange, getKanbanCards, getKanbanColumns, getScheduledMessages, getTasks, saveKanbanCard,
} from '../src/storage'
import { formatPhone } from '../src/phone'
import { C, FONT, R, SHADOW, brandUrl } from '../src/theme'
import { errorStyle, ghostBtn, inputStyle, primaryBtn, toLocalInput, quickTimes } from '../src/ui'
import { Icon } from '../src/icons'
import type { CurrentContact } from './whatsapp-bridge'
import { usePhoneDetection } from './usePhoneDetection'

interface Props {
  contact: CurrentContact | null
  onClose: () => void
  onSchedule: () => void
  onQuickAdd: () => void
}

const DAY = 86_400_000

export function ContactPanel({ contact, onClose, onSchedule, onQuickAdd }: Props) {
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [card, setCard] = useState<KanbanCard | null>(null)
  const [schedules, setSchedules] = useState<ScheduledMessage[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskWhen, setTaskWhen] = useState(toLocalInput(quickTimes()[1]?.ts ?? Date.now() + DAY))
  const [error, setError] = useState<string | null>(null)

  const [detected, setDetected] = useState<{ name: string; phone: string } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const triedAuto = useRef(new Set<string>())

  const name = contact?.name ?? ''
  const phone = contact?.phone ?? (detected && detected.name === name ? detected.phone : '')
  const detection = usePhoneDetection(null, p => setDetected({ name, phone: p }))

  const load = useCallback(async () => {
    const [cols, cards, msgs, allTasks] = await Promise.all([
      getKanbanColumns(), getKanbanCards(), getScheduledMessages(), getTasks(),
    ])
    setColumns([...cols].sort((a, b) => a.order - b.order))

    // Casa por telefone; sem telefone, só aceita nome se for único (evita card errado).
    let found: KanbanCard | undefined
    if (phone) found = cards.find(c => c.phone === phone)
    else {
      const byName = cards.filter(c => c.contactName.toLowerCase() === name.toLowerCase())
      if (byName.length === 1) found = byName[0]
    }
    setCard(found ?? null)
    setNotes(found?.notes ?? '')

    const key = found?.phone || phone
    setSchedules(key ? msgs.filter(m => m.phone === key && m.status === 'pending') : [])
    setTasks(key ? allTasks.filter(t => t.phone === key && !t.done) : [])
    setLoaded(true)
  }, [phone, name])

  useEffect(() => {
    void load()
    const onChange = () => { void load() }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [load])

  // Sem telefone e sem card: tenta descobrir o número uma vez por conversa (pelo painel "Dados do contato").
  useEffect(() => {
    if (!loaded || !contact || phone || card || triedAuto.current.has(name)) return
    triedAuto.current.add(name)
    detection.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, contact, phone, card, name])

  async function patchCard(patch: Partial<KanbanCard>) {
    if (!card) return
    const next = { ...card, ...patch, updatedAt: Date.now() }
    setCard(next)
    await saveKanbanCard(next)
  }

  async function changeColumn(columnId: string) {
    if (!card) return
    const next = applyColumnChange(card, columnId)
    setCard(next)
    await saveKanbanCard(next)
  }

  async function addTag() {
    const t = tagInput.trim().replace(/,$/, '')
    setTagInput('')
    if (!card || !t || card.tags.includes(t)) return
    await patchCard({ tags: [...card.tags, t] })
  }

  async function addTask() {
    setError(null)
    const dueAt = new Date(taskWhen).getTime()
    if (!taskTitle.trim()) return setError('Descreva a tarefa.')
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) return setError('Escolha um horário no futuro.')
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: taskTitle.trim(),
      dueAt,
      phone: card?.phone || phone || undefined,
      contactName: card?.contactName || name || undefined,
      done: false,
      createdAt: Date.now(),
    }
    await sendToBackground({ type: 'TASK_SAVE', payload: task })
    setTaskTitle('')
    setTaskWhen(toLocalInput(quickTimes()[1]?.ts ?? Date.now() + DAY))
  }

  const column = columns.find(c => c.id === card?.columnId)
  const daysStill = card ? Math.floor((Date.now() - card.columnChangedAt) / DAY) : 0
  const section: React.CSSProperties = { padding: '14px 16px', borderBottom: `1px solid ${C.line}` }
  const h4: React.CSSProperties = { margin: '0 0 8px', fontSize: '10.5px', fontWeight: 800, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'flex', alignItems: 'center', gap: '6px' }

  return (
    <aside
      aria-label="Painel do contato"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '320px', zIndex: 99998, background: C.bg,
        boxShadow: '-6px 0 24px rgba(13,15,12,0.22)', fontFamily: FONT, color: C.ink, overflowY: 'auto',
      }}
    >
      <div style={{ background: `linear-gradient(135deg, ${C.inkSoft}, ${C.brand})`, color: C.onBrand, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <img src={brandUrl('logo-up-offwhite.png')} alt="UP" style={{ height: '15px' }} />
          <span style={{ flex: 1, fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', opacity: 0.8 }}>Painel do contato</span>
          <button onClick={onClose} aria-label="Fechar painel" style={{ background: 'none', border: 'none', color: C.onBrand, display: 'flex' }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(247,244,237,0.16)', border: '1px solid rgba(247,244,237,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800, flexShrink: 0 }}>
            {name ? name[0].toUpperCase() : <Icon name="user" size={20} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'Nenhuma conversa aberta'}</div>
            <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: 500 }}>
              {phone ? formatPhone(phone) : detection.detecting ? 'detectando telefone…' : 'telefone não detectado'}
            </div>
          </div>
        </div>
        {card && column && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, background: 'rgba(247,244,237,0.16)', borderRadius: R.pill, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: column.color, border: '1px solid rgba(247,244,237,0.6)' }} /> {column.title}
            </span>
            {daysStill >= 1 && (
              <span style={{ fontSize: '11px', fontWeight: 700, background: daysStill >= 7 ? C.warnSoft : 'rgba(247,244,237,0.16)', color: daysStill >= 7 ? C.warn : C.onBrand, borderRadius: R.pill, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Icon name="clock" size={11} /> {daysStill} d nesta etapa
              </span>
            )}
          </div>
        )}
      </div>

      {!contact && (
        <div style={{ ...section, fontSize: '13px', color: C.muted, lineHeight: 1.5 }}>Abra uma conversa para ver e editar os dados do contato.</div>
      )}

      {contact && !card && (
        <div style={section}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', color: C.inkSoft, lineHeight: 1.5 }}>Este contato ainda não está no Kanban.</p>
          <button style={{ ...primaryBtn(), width: '100%' }} onClick={onQuickAdd}><Icon name="userPlus" size={16} /> Salvar no Kanban</button>
          {!phone && (
            <button style={{ ...ghostBtn, width: '100%', marginTop: '8px' }} onClick={detection.run} disabled={detection.detecting}>
              <Icon name="phone" size={15} /> {detection.detecting ? 'Detectando…' : 'Detectar telefone'}
            </button>
          )}
          {!phone && detection.failed && (
            <p style={{ margin: '8px 0 0', fontSize: '12px', color: C.warn, lineHeight: 1.45 }}>
              O WhatsApp não mostrou o número deste contato. Ao salvar, digite o telefone com DDD.
            </p>
          )}
        </div>
      )}

      {card && (
        <>
          <div style={section}>
            <h4 style={h4}><Icon name="kanban" size={13} /> Etapa</h4>
            <select style={inputStyle} value={card.columnId} onChange={e => void changeColumn(e.target.value)}>
              {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>

          <div style={section}>
            <h4 style={h4}><Icon name="tag" size={13} /> Tags</h4>
            {card.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {card.tags.map(t => (
                  <button key={t} title="Clique para remover" aria-label={`Remover tag ${t}`} onClick={() => void patchCard({ tags: card.tags.filter(x => x !== t) })}
                    style={{ fontSize: '12px', fontWeight: 700, background: C.accentSoft, color: C.brand, border: 'none', borderRadius: R.pill, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {t} <Icon name="x" size={11} strokeWidth={2.4} />
                  </button>
                ))}
              </div>
            )}
            <input
              style={inputStyle}
              value={tagInput}
              placeholder="Nova tag e Enter"
              aria-label="Nova tag"
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); void addTag() } }}
            />
          </div>

          <div style={section}>
            <h4 style={h4}><Icon name="note" size={13} /> Notas privadas</h4>
            <textarea
              style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => { if (notes !== card.notes) void patchCard({ notes }) }}
              placeholder="Só você vê isto. Salva ao sair do campo."
              aria-label="Notas privadas"
            />
          </div>
        </>
      )}

      {contact && (
        <>
          <div style={section}>
            <h4 style={h4}><Icon name="calendar" size={13} /> Follow-ups pendentes</h4>
            {schedules.length === 0 && <div style={{ fontSize: '12.5px', color: C.muted, marginBottom: '10px' }}>Nenhum agendado.</div>}
            {schedules.map(m => (
              <div key={m.id} style={{ fontSize: '12.5px', marginBottom: '8px', background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.sm, padding: '8px 10px' }}>
                <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name={m.autoSend ? 'bot' : 'hand'} size={13} style={{ color: C.brand }} />
                  {new Date(m.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <div style={{ color: C.muted, marginTop: '2px' }}>{m.message.slice(0, 60)}{m.message.length > 60 ? '…' : ''}</div>
              </div>
            ))}
            <button style={{ ...ghostBtn, width: '100%' }} onClick={onSchedule}><Icon name="plus" size={14} /> Agendar follow-up</button>
          </div>

          <div style={section}>
            <h4 style={h4}><Icon name="checkCircle" size={13} /> Tarefas</h4>
            {tasks.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12.5px', marginBottom: '8px', background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.sm, padding: '8px 10px' }}>
                <button
                  aria-label={`Concluir tarefa ${t.title}`}
                  onClick={() => sendToBackground({ type: 'TASK_DONE', payload: { id: t.id, done: true } })}
                  style={{ width: '22px', height: '22px', borderRadius: '50%', border: `1.5px solid ${C.accent}`, background: 'transparent', color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >
                  <Icon name="check" size={13} strokeWidth={3} />
                </button>
                <span style={{ flex: 1 }}>
                  <strong>{t.title}</strong>
                  <span style={{ display: 'block', color: t.dueAt <= Date.now() ? C.danger : C.muted, fontSize: '11.5px', fontWeight: 600 }}>
                    {new Date(t.dueAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </span>
              </div>
            ))}
            <input style={{ ...inputStyle, marginBottom: '8px' }} value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Ex.: ligar para fechar proposta" aria-label="Nova tarefa" onKeyDown={e => e.key === 'Enter' && void addTask()} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
              {quickTimes().map(q => (
                <button key={q.label} onClick={() => setTaskWhen(toLocalInput(q.ts))}
                  style={{ background: C.accentSoft, color: C.brand, border: `1px solid ${C.accentLine}`, borderRadius: R.pill, fontSize: '11px', fontWeight: 700, padding: '3px 9px' }}>
                  {q.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type="datetime-local" style={inputStyle} value={taskWhen} onChange={e => setTaskWhen(e.target.value)} aria-label="Quando" />
              <button style={{ ...primaryBtn(), padding: '8px 12px' }} onClick={addTask} aria-label="Criar tarefa"><Icon name="plus" size={16} /></button>
            </div>
            {error && <div role="alert" style={{ ...errorStyle, marginTop: '8px' }}>{error}</div>}
          </div>
        </>
      )}
      <div style={{ height: '24px', boxShadow: SHADOW.card, opacity: 0 }} />
    </aside>
  )
}
