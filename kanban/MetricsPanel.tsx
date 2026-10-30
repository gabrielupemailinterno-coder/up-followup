import React, { useEffect, useMemo, useState } from 'react'
import type { KanbanCard, KanbanColumn, ScheduledMessage, SendEvent, Task } from '../src/types'
import { getScheduledMessages, getSendHistory, getTasks, todayKey } from '../src/storage'
import { watchStorage } from '../src/storageWatch'
import { formatPhone } from '../src/phone'
import { C, FONT, R, SHADOW } from '../src/theme'
import { inputStyle } from '../src/ui'

const DAY = 86_400_000

export function MetricsPanel({ columns, cards }: { columns: KanbanColumn[]; cards: KanbanCard[] }) {
  const [history, setHistory] = useState<SendEvent[]>([])
  const [schedules, setSchedules] = useState<ScheduledMessage[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [staleDays, setStaleDays] = useState(7)
  const now = Date.now()

  useEffect(() => {
    const load = () => {
      void Promise.all([getSendHistory(), getScheduledMessages(), getTasks()]).then(([h, s, t]) => {
        setHistory(h); setSchedules(s); setTasks(t)
      })
    }
    load()
    return watchStorage(['wm_send_history', 'wm_scheduled_messages', 'wm_tasks'], load, 500)
  }, [])

  // Envios por dia (últimos 30, horário local)
  const days = useMemo(() => {
    const list: { key: string; label: string; count: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * DAY)
      list.push({ key: todayKey(d), label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), count: 0 })
    }
    const byKey = new Map(list.map(d => [d.key, d]))
    for (const e of history) {
      const slot = byKey.get(todayKey(new Date(e.ts)))
      if (slot) slot.count++
    }
    return list
  }, [history, now])

  const sentToday = days[days.length - 1].count
  const sent7 = days.slice(-7).reduce((n, d) => n + d.count, 0)
  const sent30 = days.reduce((n, d) => n + d.count, 0)

  const fu = useMemo(() => {
    const sent = schedules.filter(s => s.status === 'sent').length
    const failed = schedules.filter(s => s.status === 'failed').length
    const skipped = schedules.filter(s => s.status === 'skipped').length
    const overdue = schedules.filter(s => s.status === 'pending' && s.scheduledAt <= now).length
    const closed = sent + failed + skipped + overdue
    return { sent, failed, skipped, overdue, rate: closed ? Math.round((sent / closed) * 100) : null }
  }, [schedules, now])

  const openTasks = tasks.filter(t => !t.done)
  const overdueTasks = openTasks.filter(t => t.dueAt <= now)

  const byColumn = useMemo(() => columns.map(col => {
    const inCol = cards.filter(c => c.columnId === col.id)
    const avgDays = inCol.length
      ? inCol.reduce((n, c) => n + (now - c.columnChangedAt) / DAY, 0) / inCol.length
      : 0
    return { col, count: inCol.length, avgDays }
  }), [columns, cards, now])

  const maxCount = Math.max(1, ...byColumn.map(b => b.count))
  const maxAvg = Math.max(1, ...byColumn.map(b => b.avgDays))
  const colName = new Map(columns.map(c => [c.id, c.title]))
  const stale = cards
    .map(c => ({ card: c, days: (now - c.columnChangedAt) / DAY }))
    .filter(x => x.days >= staleDays)
    .sort((a, b) => b.days - a.days)
    .slice(0, 15)

  const maxDay = Math.max(1, ...days.map(d => d.count))

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 22px 40px', fontFamily: FONT, color: C.ink }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: C.brand }}>Métricas</h2>
        <p style={{ margin: '2px 0 16px', fontSize: '13px', color: C.muted }}>Resumo dos seus follow-ups, envios e leads. Os dados ficam só neste navegador.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <Tile label="Enviados hoje" value={sentToday} />
          <Tile label="Últimos 7 dias" value={sent7} />
          <Tile label="Últimos 30 dias" value={sent30} />
          <Tile label="Follow-ups vencidos" value={fu.overdue} tone={fu.overdue ? 'danger' : undefined} />
          <Tile label="Taxa de conclusão" value={fu.rate === null ? '—' : `${fu.rate}%`} hint={`${fu.sent} enviados · ${fu.failed} falhas · ${fu.skipped} pulados`} />
          <Tile label="Tarefas abertas" value={openTasks.length} hint={overdueTasks.length ? `${overdueTasks.length} vencida(s)` : undefined} tone={overdueTasks.length ? 'danger' : undefined} />
        </div>

        <Card title="Envios por dia (últimos 30 dias)">
          {sent30 === 0 ? <Empty>Sem envios registrados ainda. O histórico começa a ser gravado a partir desta versão.</Empty> : (
            <svg viewBox="0 0 600 140" width="100%" role="img" aria-label="Envios por dia nos últimos 30 dias">
              {days.map((d, i) => {
                const h = (d.count / maxDay) * 96
                return (
                  <g key={d.key}>
                    <title>{`${d.label}: ${d.count} envio(s)`}</title>
                    <rect x={i * 20 + 3} y={110 - h} width={14} height={Math.max(h, d.count ? 2 : 0)} rx={3} fill={i === days.length - 1 ? C.brand : C.accent} />
                    {i % 5 === 0 && <text x={i * 20 + 10} y={128} fontSize={9} textAnchor="middle" fill={C.muted} fontFamily={FONT}>{d.label}</text>}
                  </g>
                )
              })}
              <line x1={0} y1={110} x2={600} y2={110} stroke={C.line} />
            </svg>
          )}
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '14px' }}>
          <Card title="Leads por coluna">
            {byColumn.map(({ col, count }) => (
              <Bar key={col.id} label={col.title} display={String(count)} pct={(count / maxCount) * 100} color={col.color} />
            ))}
          </Card>
          <Card title="Tempo médio parado por etapa (dias)">
            {byColumn.map(({ col, avgDays, count }) => (
              <Bar key={col.id} label={col.title} display={count ? avgDays.toFixed(1) : '—'} pct={(avgDays / maxAvg) * 100} color={col.color} />
            ))}
          </Card>
        </div>

        <Card title="Leads parados">
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontWeight: 600, color: C.inkSoft }}>
            Mostrar parados há pelo menos
            <input type="number" min={1} style={{ ...inputStyle, width: '72px' }} value={staleDays} onChange={e => setStaleDays(Math.max(1, Number(e.target.value) || 1))} />
            dias
          </label>
          {stale.length === 0 ? <Empty>Nenhum lead parado por esse tempo.</Empty> : (
            <table style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <tbody>
                {stale.map(({ card, days: d }) => (
                  <tr key={card.id} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '8px 6px', fontWeight: 700 }}>{card.contactName}</td>
                    <td style={{ padding: '8px 6px', color: C.muted }}>{formatPhone(card.phone)}</td>
                    <td style={{ padding: '8px 6px' }}>{colName.get(card.columnId)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: C.warn, fontWeight: 800 }}>{Math.floor(d)} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}

function Tile({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'danger' }) {
  return (
    <div style={{ background: C.surface, borderRadius: R.lg, padding: '14px 16px', boxShadow: SHADOW.card, border: `1px solid ${C.line}` }}>
      <div style={{ fontSize: '28px', fontWeight: 800, color: tone === 'danger' ? C.danger : C.brand, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: '12px', color: C.inkSoft, fontWeight: 700, marginTop: '4px' }}>{label}</div>
      {hint && <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px' }}>{hint}</div>}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, borderRadius: R.lg, padding: '16px 18px', marginBottom: '14px', boxShadow: SHADOW.card, border: `1px solid ${C.line}` }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 800, color: C.brand }}>{title}</h3>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: '12.5px', color: C.muted }}>{children}</p>
}

function Bar({ label, display, pct, color }: { label: string; display: string; pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', fontSize: '12.5px' }}>
      <div style={{ width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: C.inkSoft }}>{label}</div>
      <div style={{ flex: 1, background: '#ECEAE0', borderRadius: R.pill, height: '10px' }}>
        <div style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%`, background: color, height: '10px', borderRadius: R.pill }} />
      </div>
      <div style={{ width: '38px', textAlign: 'right', fontWeight: 800 }}>{display}</div>
    </div>
  )
}
