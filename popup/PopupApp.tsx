import React, { useCallback, useEffect, useState } from 'react'
import type { CrmDiag, CrmJob, CrmLead, ScheduledMessage, Task } from '../src/types'
import { sendToBackground } from '../src/types'
import {
  ensureSchema, getKanbanCards, getScheduledMessages, getSettings, getTasks, getTodayLog, getCrmJobs, getCrmLeads, getCrmDiag,
} from '../src/storage'
import { findStaleLeads } from '../src/crm'
import { watchStorage } from '../src/storageWatch'
import { formatPhone } from '../src/phone'
import { C, FONT, R, SHADOW } from '../src/theme'
import { errorStyle, inputStyle, quickTimes, toLocalInput } from '../src/ui'
import { Icon, type IconName } from '../src/icons'

type Tab = 'queue' | 'tasks' | 'history' | 'crm'

const HIDE_KEY = 'wm_hide_onboarding'
const logo = (f: string) => chrome.runtime.getURL(`brand/${f}`)

function relTime(ts: number, now: number): string {
  const diff = ts - now
  const abs = Math.abs(diff)
  const min = Math.round(abs / 60_000)
  const hr = Math.round(abs / 3_600_000)
  const day = Math.round(abs / 86_400_000)
  const unit = abs < 3_600_000 ? `${Math.max(min, 1)} min` : abs < 86_400_000 ? `${hr} h` : `${day} d`
  return diff >= 0 ? `em ${unit}` : `venceu há ${unit}`
}

export default function PopupApp() {
  const [messages, setMessages] = useState<ScheduledMessage[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [usage, setUsage] = useState({ count: 0, limit: 30 })
  const [cardCount, setCardCount] = useState(0)
  const [hasWaTab, setHasWaTab] = useState(false)
  const [crmJobs, setCrmJobs] = useState<CrmJob[]>([])
  const [crmLeads, setCrmLeads] = useState<CrmLead[]>([])
  const [crmCfg, setCrmCfg] = useState({ enabled: false, dryRun: true })
  const [crmDiag, setCrmDiag] = useState<CrmDiag | null>(null)
  const [hideOnboarding, setHideOnboarding] = useState(true)
  const [tab, setTab] = useState<Tab | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    await ensureSchema()
    const [msgs, log, settings, allTasks, cards, tabs, hidden, jobs, leads, diag] = await Promise.all([
      getScheduledMessages(), getTodayLog(), getSettings(), getTasks(), getKanbanCards(),
      chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }),
      chrome.storage.local.get(HIDE_KEY),
      getCrmJobs(), getCrmLeads(), getCrmDiag(),
    ])
    setCrmDiag(diag)
    setCrmJobs([...jobs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 40))
    setCrmLeads(leads)
    setCrmCfg({ enabled: settings.crmEnabled, dryRun: settings.crmDryRun })
    setMessages(msgs.sort((a, b) => a.scheduledAt - b.scheduledAt))
    setTasks(allTasks.filter(t => !t.done).sort((a, b) => a.dueAt - b.dueAt))
    setUsage({ count: log.count, limit: settings.dailyLimit })
    setCardCount(cards.length)
    setHasWaTab(tabs.length > 0)
    setHideOnboarding(Boolean(hidden[HIDE_KEY]))
    setNow(Date.now())
  }, [])

  useEffect(() => {
    void load()
    return watchStorage(
      ['wm_scheduled_messages', 'wm_tasks', 'wm_send_log', 'wm_settings', 'wm_kanban_cards', 'wm_crm_jobs', 'wm_crm_leads', 'wm_crm_diag', HIDE_KEY],
      () => { void load() }, 300
    )
  }, [load])

  async function act(promise: Promise<{ ok: boolean; message?: string }>) {
    setError(null)
    const r = await promise
    if (!r.ok) setError(r.message ?? 'Não foi possível concluir a ação.')
    else void load()
  }

  const overdue = messages.filter(m => m.status === 'pending' && m.scheduledAt <= now)
  const upcoming = messages.filter(m => m.status === 'pending' && m.scheduledAt > now)
  const history = messages.filter(m => m.status !== 'pending').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
  const overdueTasks = tasks.filter(t => t.dueAt <= now)

  const activeTab: Tab = tab ?? (overdue.length > 0 ? 'queue' : tasks.length > 0 && upcoming.length === 0 ? 'tasks' : 'queue')

  const steps = [
    { done: hasWaTab, label: 'Abra o WhatsApp Web e conecte sua conta', action: () => chrome.tabs.create({ url: 'https://web.whatsapp.com/' }), cta: 'Abrir' },
    { done: cardCount > 0, label: 'Salve seu primeiro contato no Kanban', action: () => sendToBackground({ type: 'OPEN_KANBAN' }), cta: 'Kanban' },
    { done: messages.length > 0, label: 'Agende seu primeiro follow-up', action: () => sendToBackground({ type: 'OPEN_MANUAL', payload: { hash: 'agendar' } }), cta: 'Como' },
  ]
  const showOnboarding = !hideOnboarding && !steps.every(s => s.done)
  const pct = usage.limit ? Math.min(100, (usage.count / usage.limit) * 100) : 0

  return (
    <div style={{ width: '400px', fontFamily: FONT, color: C.ink, background: C.bg }}>
      {/* Cabeçalho */}
      <div style={{ background: `linear-gradient(135deg, ${C.inkSoft} 0%, ${C.brand} 55%, #56654F 100%)`, padding: '16px 18px 14px', color: C.onBrand }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={logo('logo-up-offwhite.png')} alt="UP" style={{ height: '22px' }} />
          <span style={{ width: '1px', height: '22px', background: 'rgba(247,244,237,0.35)' }} />
          <div style={{ flex: 1, lineHeight: 1.15 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.01em' }}>Follow-up</div>
            <div style={{ fontSize: '10.5px', opacity: 0.75 }}>WhatsApp Web · uso interno</div>
          </div>
          <IconBtn icon="book" label="Manual de uso" onClick={() => sendToBackground({ type: 'OPEN_MANUAL' })} />
          <IconBtn icon="sliders" label="Configurações" onClick={() => sendToBackground({ type: 'OPEN_KANBAN', payload: { hash: 'config' } })} />
        </div>

        <div style={{ marginTop: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600, marginBottom: '5px', opacity: 0.9 }}>
            <span>Envios de hoje</span>
            <span>{usage.count} de {usage.limit}</span>
          </div>
          <div style={{ height: '6px', background: 'rgba(247,244,237,0.22)', borderRadius: R.pill }} role="progressbar" aria-valuenow={usage.count} aria-valuemax={usage.limit} aria-label="Envios de hoje">
            <div style={{ height: '6px', width: `${pct}%`, background: pct >= 80 ? '#F0C27A' : C.onBrand, borderRadius: R.pill, transition: 'width .3s' }} />
          </div>
        </div>
      </div>

      {/* Atalhos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', padding: '12px 14px 4px' }}>
        <Shortcut icon="chat" label="WhatsApp" onClick={() => chrome.tabs.create({ url: 'https://web.whatsapp.com/' })} />
        <Shortcut icon="kanban" label="Kanban" onClick={() => sendToBackground({ type: 'OPEN_KANBAN' })} />
        <Shortcut icon="megaphone" label="Campanhas" onClick={() => sendToBackground({ type: 'OPEN_KANBAN', payload: { hash: 'campanhas' } })} />
        <Shortcut icon="chart" label="Métricas" onClick={() => sendToBackground({ type: 'OPEN_KANBAN', payload: { hash: 'metricas' } })} />
      </div>

      {/* Primeiros passos */}
      {showOnboarding && (
        <div style={{ margin: '10px 14px 0', background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '12px 14px', boxShadow: SHADOW.card }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ flex: 1, fontSize: '12.5px', color: C.brand }}>Primeiros passos</strong>
            <button
              onClick={() => chrome.storage.local.set({ [HIDE_KEY]: true })}
              style={{ background: 'none', border: 'none', color: C.muted, fontSize: '11px', fontWeight: 600 }}
            >
              Ocultar
            </button>
          </div>
          {steps.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
              <span style={{
                width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: s.done ? C.ok : 'transparent', border: `1.5px solid ${s.done ? C.ok : C.lineStrong}`, color: '#fff', fontSize: '10px', fontWeight: 800,
              }}>
                {s.done ? <Icon name="check" size={12} strokeWidth={3} /> : <span style={{ color: C.muted }}>{i + 1}</span>}
              </span>
              <span style={{ flex: 1, fontSize: '12px', color: s.done ? C.muted : C.ink, textDecoration: s.done ? 'line-through' : 'none', fontWeight: 500 }}>{s.label}</span>
              {!s.done && <button onClick={s.action} style={smallLink}>{s.cta}</button>}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ ...errorStyle, margin: '10px 14px 0' }}>{error}</div>}

      {/* Abas */}
      <div role="tablist" style={{ display: 'flex', gap: '4px', padding: '14px 14px 0' }}>
        <TabBtn active={activeTab === 'queue'} onClick={() => setTab('queue')} count={overdue.length + upcoming.length} alert={overdue.length > 0}>Fila</TabBtn>
        <TabBtn active={activeTab === 'tasks'} onClick={() => setTab('tasks')} count={tasks.length} alert={overdueTasks.length > 0}>Tarefas</TabBtn>
        <TabBtn active={activeTab === 'history'} onClick={() => setTab('history')} count={0}>Histórico</TabBtn>
        <TabBtn active={activeTab === 'crm'} onClick={() => setTab('crm')} count={crmJobs.filter(j => j.status === 'failed' || j.status === 'pending' || j.status === 'running').length} alert={crmJobs.some(j => j.status === 'failed')}>CRM</TabBtn>
      </div>

      <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '10px 14px 14px', borderTop: `1px solid ${C.line}`, marginTop: '-1px' }}>
        {activeTab === 'queue' && (
          <>
            {overdue.length + upcoming.length === 0 && (
              <Empty icon="calendar" title="Nenhum follow-up na fila" text="Abra uma conversa no WhatsApp Web e clique em Agendar no painel UP." />
            )}
            {overdue.length > 0 && <GroupLabel tone="danger">Vencidos · precisam da sua decisão</GroupLabel>}
            {overdue.map(m => (
              <Row key={m.id} msg={m} now={now} overdue
                onReschedule={at => act(sendToBackground({ type: 'RESCHEDULE', payload: { id: m.id, scheduledAt: at } }))}>
                <MiniBtn primary icon="send" onClick={() => act(sendToBackground({ type: 'SEND_NOW', payload: { id: m.id } }))}>Enviar</MiniBtn>
                <MiniBtn onClick={() => act(sendToBackground({ type: 'SKIP', payload: { id: m.id } }))}>Pular</MiniBtn>
              </Row>
            ))}
            {upcoming.length > 0 && <GroupLabel>Próximos</GroupLabel>}
            {upcoming.map(m => (
              <Row key={m.id} msg={m} now={now}
                onReschedule={at => act(sendToBackground({ type: 'RESCHEDULE', payload: { id: m.id, scheduledAt: at } }))}>
                <MiniBtn icon="send" onClick={() => act(sendToBackground({ type: 'SEND_NOW', payload: { id: m.id } }))}>Enviar já</MiniBtn>
                <MiniBtn danger onClick={() => act(sendToBackground({ type: 'CANCEL_SCHEDULE', payload: { id: m.id } }))}>Cancelar</MiniBtn>
              </Row>
            ))}
          </>
        )}

        {activeTab === 'tasks' && (
          <>
            {tasks.length === 0 && <Empty icon="checkCircle" title="Sem tarefas abertas" text="Crie lembretes como “ligar para o cliente” abaixo ou pelo painel do contato." />}
            {tasks.map(t => (
              <div key={t.id} style={{ ...card, display: 'flex', gap: '10px', alignItems: 'center', borderLeft: `3px solid ${t.dueAt <= now ? C.danger : C.accent}` }}>
                <MiniBtn primary icon="check" onClick={() => act(sendToBackground({ type: 'TASK_DONE', payload: { id: t.id, done: true } }))}>Feito</MiniBtn>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 700 }}>{t.title}</div>
                  <div style={{ fontSize: '11px', color: t.dueAt <= now ? C.danger : C.muted, fontWeight: 600 }}>
                    {t.contactName ? `${t.contactName} · ` : ''}{relTime(t.dueAt, now)}
                  </div>
                </div>
                <MiniBtn danger icon="trash" onClick={() => act(sendToBackground({ type: 'TASK_DELETE', payload: { id: t.id } }))} label="Excluir tarefa" />
              </div>
            ))}
            <TaskForm onSave={task => act(sendToBackground({ type: 'TASK_SAVE', payload: task }))} />
          </>
        )}

        {activeTab === 'crm' && (
          <CrmTab jobs={crmJobs} leads={crmLeads} cfg={crmCfg} diag={crmDiag} now={now} act={act} />
        )}

        {activeTab === 'history' && (
          <>
            {history.length === 0 && <Empty icon="clock" title="Histórico vazio" text="Os envios e falhas aparecem aqui." />}
            {history.map(m => (
              <Row key={m.id} msg={m} now={now}
                onReschedule={m.status === 'failed' || m.status === 'skipped'
                  ? at => act(sendToBackground({ type: 'RESCHEDULE', payload: { id: m.id, scheduledAt: at } }))
                  : undefined}>
                <MiniBtn danger onClick={() => act(sendToBackground({ type: 'CANCEL_SCHEDULE', payload: { id: m.id } }))}>Remover</MiniBtn>
              </Row>
            ))}
          </>
        )}
      </div>

      <div style={{ padding: '8px 16px', background: C.surface, borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: C.muted, fontWeight: 600 }}>
        <span>UP Consultoria Imobiliária</span>
        <span>v{chrome.runtime.getManifest().version}</span>
      </div>
    </div>
  )
}

// ─── Peças ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px 12px', marginBottom: '8px',
}
const smallLink: React.CSSProperties = {
  background: C.accentSoft, color: C.brand, border: `1px solid ${C.accentLine}`, borderRadius: R.pill,
  fontSize: '11px', fontWeight: 700, padding: '3px 10px',
}

function IconBtn({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ width: '30px', height: '30px', borderRadius: R.sm, border: '1px solid rgba(247,244,237,0.3)', background: 'rgba(247,244,237,0.08)', color: C.onBrand, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={16} />
    </button>
  )
}

function Shortcut({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', color: C.brand, fontSize: '11px', fontWeight: 700 }}
    >
      <Icon name={icon} size={20} />
      <span style={{ color: C.inkSoft }}>{label}</span>
    </button>
  )
}

function TabBtn({ active, onClick, count, alert, children }: { active: boolean; onClick: () => void; count: number; alert?: boolean; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '8px 14px', border: `1px solid ${active ? C.line : 'transparent'}`, borderBottom: 'none',
        borderRadius: `${R.sm} ${R.sm} 0 0`, background: active ? C.bg : 'transparent', position: 'relative', top: '1px',
        fontSize: '12.5px', fontWeight: active ? 800 : 600, color: active ? C.brand : C.muted, display: 'flex', gap: '6px', alignItems: 'center',
      }}
    >
      {children}
      {count > 0 && (
        <span style={{ fontSize: '10px', fontWeight: 800, minWidth: '18px', padding: '1px 5px', borderRadius: R.pill, background: alert ? C.danger : C.accentSoft, color: alert ? '#fff' : C.brand }}>
          {count}
        </span>
      )}
    </button>
  )
}

function GroupLabel({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: tone === 'danger' ? C.danger : C.muted, margin: '6px 2px 8px' }}>
      {children}
    </div>
  )
}

function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '26px 16px', color: C.muted }}>
      <div style={{ width: '44px', height: '44px', margin: '0 auto 10px', borderRadius: '50%', background: C.accentSoft, color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} />
      </div>
      <div style={{ fontSize: '13px', fontWeight: 800, color: C.inkSoft, marginBottom: '2px' }}>{title}</div>
      <div style={{ fontSize: '12px', lineHeight: 1.45 }}>{text}</div>
    </div>
  )
}

const STATUS: Record<ScheduledMessage['status'], { label: string; fg: string; bg: string }> = {
  pending: { label: 'Pendente', fg: C.warn, bg: C.warnSoft },
  sent: { label: 'Enviado', fg: C.ok, bg: C.okSoft },
  failed: { label: 'Falhou', fg: C.danger, bg: C.dangerSoft },
  skipped: { label: 'Pulado', fg: C.muted, bg: '#ECEAE0' },
}
const RECURRENCE: Record<ScheduledMessage['recurrence'], string> = { none: '', daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' }

function Row({
  msg, now, overdue, children, onReschedule,
}: {
  msg: ScheduledMessage
  now: number
  overdue?: boolean
  children: React.ReactNode
  onReschedule?: (at: number) => void
}) {
  const [picking, setPicking] = useState(false)
  const [value, setValue] = useState(toLocalInput(Date.now() + 3_600_000))
  const st = STATUS[msg.status]
  const when = new Date(msg.scheduledAt)
  const isPending = msg.status === 'pending'

  return (
    <div style={{ ...card, borderLeft: `3px solid ${overdue ? C.danger : isPending ? C.accent : st.fg}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 800, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.contactName}</span>
        {!isPending && <Chip fg={st.fg} bg={st.bg}>{st.label}</Chip>}
        {RECURRENCE[msg.recurrence] && <Chip fg={C.info} bg={C.infoSoft}><Icon name="repeat" size={10} /> {RECURRENCE[msg.recurrence]}</Chip>}
        <Chip fg={msg.autoSend ? C.brand : C.muted} bg={msg.autoSend ? C.accentSoft : '#ECEAE0'}>
          <Icon name={msg.autoSend ? 'bot' : 'hand'} size={11} /> {msg.autoSend ? 'Automático' : 'Confirmar'}
        </Chip>
      </div>
      <div style={{ fontSize: '11px', color: C.muted, margin: '3px 0 6px', fontWeight: 600 }}>
        {formatPhone(msg.phone) || 'sem telefone'} ·{' '}
        <span style={{ color: overdue ? C.danger : C.muted }}>
          {isPending ? relTime(msg.scheduledAt, now) : when.toLocaleDateString('pt-BR')} · {when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: '12px', color: C.inkSoft, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {msg.message}
      </p>
      {msg.failReason && <div style={{ ...errorStyle, marginBottom: '8px' }}>{msg.failReason}</div>}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {children}
        {onReschedule && <MiniBtn icon="clock" onClick={() => setPicking(!picking)}>Reagendar</MiniBtn>}
      </div>

      {picking && onReschedule && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px dashed ${C.line}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
            {quickTimes().map(q => (
              <button key={q.label} onClick={() => { onReschedule(q.ts); setPicking(false) }} style={smallLink}>{q.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input type="datetime-local" style={inputStyle} value={value} onChange={e => setValue(e.target.value)} />
            <MiniBtn primary onClick={() => { onReschedule(new Date(value).getTime()); setPicking(false) }}>OK</MiniBtn>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({ fg, bg, children }: { fg: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: 800, color: fg, background: bg, borderRadius: R.pill, padding: '2px 8px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

function TaskForm({ onSave }: { onSave: (task: Task) => void }) {
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(toLocalInput(quickTimes()[1]?.ts ?? Date.now() + 86_400_000))
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    const dueAt = new Date(when).getTime()
    if (!title.trim()) return setErr('Descreva a tarefa.')
    if (!Number.isFinite(dueAt) || dueAt <= Date.now()) return setErr('Escolha um horário no futuro.')
    setErr(null)
    onSave({ id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`, title: title.trim(), dueAt, done: false, createdAt: Date.now() })
    setTitle('')
  }

  return (
    <div style={{ ...card, marginTop: '10px', background: C.accentSoft, borderColor: C.accentLine }}>
      <div style={{ fontSize: '11.5px', fontWeight: 800, color: C.brand, marginBottom: '6px' }}>Nova tarefa</div>
      <input style={{ ...inputStyle, marginBottom: '6px' }} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: ligar para o João sobre a proposta" onKeyDown={e => e.key === 'Enter' && submit()} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
        {quickTimes().map(q => <button key={q.label} onClick={() => setWhen(toLocalInput(q.ts))} style={smallLink}>{q.label}</button>)}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input type="datetime-local" style={inputStyle} value={when} onChange={e => setWhen(e.target.value)} />
        <MiniBtn primary icon="plus" onClick={submit}>Criar</MiniBtn>
      </div>
      {err && <div style={{ ...errorStyle, marginTop: '6px' }}>{err}</div>}
    </div>
  )
}

function MiniBtn({
  children, onClick, primary, danger, icon, label,
}: {
  children?: React.ReactNode
  onClick: () => void
  primary?: boolean
  danger?: boolean
  icon?: IconName
  label?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        padding: children ? '5px 11px' : '5px 8px', borderRadius: R.sm, fontSize: '11.5px', fontWeight: 700, fontFamily: 'inherit',
        whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px',
        border: primary ? 'none' : `1px solid ${danger ? '#E6BFB4' : C.lineStrong}`,
        background: primary ? C.brand : danger ? C.dangerSoft : '#fff',
        color: primary ? C.onBrand : danger ? C.danger : C.inkSoft,
      }}
    >
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  )
}

// ─── Aba CRM ──────────────────────────────────────────────────────────────────

const CRM_STATUS: Record<CrmJob['status'], { label: string; fg: string; bg: string }> = {
  pending: { label: 'Aguardando', fg: C.warn, bg: C.warnSoft },
  running: { label: 'Registrando…', fg: C.info, bg: C.infoSoft },
  done: { label: 'Registrada', fg: C.ok, bg: C.okSoft },
  tested: { label: 'Teste ok (não enviada)', fg: C.info, bg: C.infoSoft },
  failed: { label: 'Falhou', fg: C.danger, bg: C.dangerSoft },
  skipped: { label: 'Não registrada', fg: C.muted, bg: '#ECEAE0' },
}

function CrmTab({
  jobs, leads, cfg, diag, now, act,
}: {
  jobs: CrmJob[]
  leads: CrmLead[]
  cfg: { enabled: boolean; dryRun: boolean }
  diag: CrmDiag | null
  now: number
  act: (p: Promise<{ ok: boolean; message?: string }>) => void
}) {
  const stale = findStaleLeads(leads, now, 2).slice(0, 8)
  const withPhone = new Map(leads.flatMap(l => l.phones.map(p => [l.id, p] as const)))

  return (
    <>
      {!cfg.enabled ? (
        <div style={{ ...card, background: C.warnSoft, borderColor: '#E9D5A6', color: C.warn, fontSize: '12px', lineHeight: 1.45 }}>
          <strong>Registro no CRM desligado.</strong> Ligue em Configurações &gt; CRM Incbook para lançar a atividade automaticamente depois de cada envio.
          <div style={{ marginTop: '6px' }}>
            <MiniBtn icon="sliders" onClick={() => sendToBackground({ type: 'OPEN_KANBAN', payload: { hash: 'config' } })}>Abrir configurações</MiniBtn>
          </div>
        </div>
      ) : cfg.dryRun ? (
        <div style={{ ...card, background: C.infoSoft, borderColor: '#C3D6E1', color: C.info, fontSize: '12px', lineHeight: 1.45 }}>
          <strong>Modo teste.</strong> A extensão preenche o formulário do CRM, mas <strong>não envia</strong>. Valide em um lead de teste e depois desligue em Configurações.
        </div>
      ) : null}

      <div style={{ ...card, fontSize: '12px', lineHeight: 1.45, color: C.inkSoft }}>
        <strong>Último envio:</strong>{' '}
        {diag
          ? <>{new Date(diag.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {formatPhone(diag.phone)}<br /><span style={{ color: diag.result === 'error' || diag.result === 'disabled' ? C.danger : C.muted, fontWeight: 600 }}>{diag.detail}</span></>
          : <span style={{ color: C.muted }}>nenhum envio visto ainda por esta versão da extensão.</span>}
      </div>

      <GroupLabel>Atividades no CRM</GroupLabel>
      {jobs.length === 0 && <Empty icon="list" title="Nada na fila do CRM" text="Depois de cada envio, a atividade aparece aqui com o resultado." />}
      {jobs.map(j => {
        const st = CRM_STATUS[j.status]
        return (
          <div key={j.id} style={{ ...card, borderLeft: `3px solid ${st.fg}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 800, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.contactName}</span>
              <Chip fg={st.fg} bg={st.bg}>{st.label}</Chip>
            </div>
            <div style={{ fontSize: '11px', color: C.muted, margin: '3px 0', fontWeight: 600 }}>
              {formatPhone(j.phone)} · {j.activityType} · {new Date(j.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
            {j.message && <div style={{ fontSize: '12px', color: j.status === 'failed' ? C.danger : C.inkSoft, lineHeight: 1.4, marginBottom: '6px' }}>{j.message}</div>}
            <div style={{ display: 'flex', gap: '6px' }}>
              {(j.status === 'failed' || j.status === 'tested' || j.status === 'skipped') && (
                <MiniBtn primary icon="repeat" onClick={() => act(sendToBackground({ type: 'CRM_RETRY', payload: { id: j.id } }))}>{j.status === 'tested' ? (cfg.dryRun ? 'Repetir teste' : 'Registrar de verdade') : 'Tentar de novo'}</MiniBtn>
              )}
              <MiniBtn danger onClick={() => act(sendToBackground({ type: 'CRM_DISCARD', payload: { id: j.id } }))}>Descartar</MiniBtn>
            </div>
          </div>
        )
      })}

      <GroupLabel>Leads sem ação na etapa (CRM)</GroupLabel>
      {leads.length === 0 && <Empty icon="user" title="Ainda sem dados do CRM" text="Abra o CRM (telas Leads ou Funil) neste navegador: a extensão lê os leads sozinha." />}
      {leads.length > 0 && stale.length === 0 && <div style={{ fontSize: '12px', color: C.muted, marginBottom: '8px' }}>Nenhum lead parado há mais de 2 dias, entre os {leads.length} lidos.</div>}
      {stale.map(({ lead, daysInStage }) => (
        <div key={lead.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.name}</div>
            <div style={{ fontSize: '11px', color: C.warn, fontWeight: 700 }}>{Math.floor(daysInStage)} dias na etapa, sem ação</div>
          </div>
          {lead.phones[0] && (
            <MiniBtn icon="chat" onClick={() => sendToBackground({ type: 'OPEN_CHAT', payload: { phone: lead.phones[0] } })}>Abrir conversa</MiniBtn>
          )}
        </div>
      ))}
      {stale.some(s => !withPhone.has(s.lead.id)) && (
        <div style={{ fontSize: '11px', color: C.muted, lineHeight: 1.4 }}>
          Leads sem telefone aparecem sem o botão: abra a tela Leads do CRM para a extensão ler o telefone.
        </div>
      )}
    </>
  )
}
