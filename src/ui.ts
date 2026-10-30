import type React from 'react'
import { C, FONT, R, SHADOW } from './theme'

export { FONT }

export const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(13,15,12,0.55)', zIndex: 999999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT,
}

export const modalStyle = (width = 420): React.CSSProperties => ({
  background: C.surface, borderRadius: R.lg, padding: '22px', width: `${width}px`,
  maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
  boxShadow: SHADOW.pop, color: C.ink, fontFamily: FONT,
})

export const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '6px',
  fontSize: '12px', fontWeight: 700, color: C.inkSoft,
}

export const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: R.sm, border: `1.5px solid ${C.lineStrong}`, fontSize: '13px',
  outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff', color: C.ink,
  fontWeight: 500,
}

export const primaryBtn = (disabled = false): React.CSSProperties => ({
  padding: '10px 16px', borderRadius: R.sm, border: 'none',
  background: disabled ? '#B9BCAE' : C.brand, color: C.onBrand, fontSize: '13px', fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
})

export const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: R.sm, border: `1px solid ${C.lineStrong}`, background: '#fff',
  fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: C.inkSoft,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
}

export const dangerBtn: React.CSSProperties = {
  ...ghostBtn, border: '1px solid #E6BFB4', background: C.dangerSoft, color: C.danger,
}

export const errorStyle: React.CSSProperties = {
  background: C.dangerSoft, color: C.danger, border: '1px solid #EBC4BA',
  borderRadius: R.sm, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
}

export const noteStyle: React.CSSProperties = {
  background: C.accentSoft, color: C.inkSoft, border: `1px solid ${C.accentLine}`,
  borderRadius: R.sm, padding: '8px 12px', fontSize: '12px',
}

export const warnStyle: React.CSSProperties = {
  background: C.warnSoft, color: C.warn, border: '1px solid #E9D5A6',
  borderRadius: R.sm, padding: '8px 12px', fontSize: '12px',
}

export const okStyle: React.CSSProperties = {
  background: C.okSoft, color: C.ok, border: '1px solid #BCD8C2',
  borderRadius: R.sm, padding: '8px 12px', fontSize: '12px', fontWeight: 600,
}

/** Valor para <input type="datetime-local"> no fuso local. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Atalhos de horário para agendamentos e tarefas. */
export function quickTimes(now = new Date()): { label: string; ts: number }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }
  const list: { label: string; ts: number }[] = [{ label: 'Em 1 hora', ts: now.getTime() + 3_600_000 }]
  if (at(0, 18) > now.getTime() + 600_000) list.push({ label: 'Hoje 18h', ts: at(0, 18) })
  list.push({ label: 'Amanhã 9h', ts: at(1, 9) })
  list.push({ label: 'Em 3 dias', ts: at(3, 9) })
  const toMonday = ((8 - now.getDay()) % 7) || 7
  list.push({ label: 'Segunda 9h', ts: at(toMonday, 9) })
  return list
}
