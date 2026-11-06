/**
 * Barra fixa de controle da campanha em andamento: Pausar / Retomar / Parar sempre à mão.
 * Pode ser recolhida com um clique para não cobrir o WhatsApp.
 */

import React, { useEffect, useState } from 'react'
import type { Campaign } from '../src/types'
import { sendToBackground } from '../src/types'
import { getCampaigns, STORAGE_KEYS as K } from '../src/storage'
import { watchStorage } from '../src/storageWatch'
import { safeInterval } from '../src/alive'
import { campaignProgress } from '../src/campaign'
import { C, FONT, R, SHADOW } from '../src/theme'
import { Icon, type IconName } from '../src/icons'

export function CampaignBar() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [now, setNow] = useState(Date.now())
  const [confirmStop, setConfirmStop] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const load = () => { void getCampaigns().then(setCampaigns) }
    load()
    const stop = watchStorage([K.CAMPAIGNS], load, 150)
    return stop
  }, [])

  const active = campaigns.filter(c => c.status === 'running' || c.status === 'paused')
  const hasActive = active.length > 0

  useEffect(() => {
    if (!hasActive) return
    return safeInterval(() => setNow(Date.now()), 1000)
  }, [hasActive])

  // Expande automaticamente quando uma nova campanha começa
  useEffect(() => {
    if (hasActive) setCollapsed(false)
  }, [hasActive])

  if (!hasActive) return null

  // ── Versão recolhida: só uma pílula discreta ────────────────────────────────
  if (collapsed) {
    const running = active.some(c => c.status === 'running')
    return (
      <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 99999, fontFamily: FONT }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Expandir barra de campanha"
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: `linear-gradient(135deg, ${C.inkSoft}, ${C.brand})`,
            color: C.onBrand, border: 'none', borderRadius: R.pill,
            padding: '7px 14px', fontSize: '12px', fontWeight: 700,
            fontFamily: 'inherit', boxShadow: SHADOW.pop, cursor: 'pointer',
          }}
        >
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: running ? '#7EE8A2' : '#F3D87A', flexShrink: 0 }} />
          <Icon name="megaphone" size={13} />
          {active.length === 1 ? active[0].name : `${active.length} campanhas`}
          <Icon name="chevronDown" size={12} style={{ opacity: 0.7, transform: 'rotate(180deg)' }} />
        </button>
      </div>
    )
  }

  // ── Versão expandida ────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 99999, display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: FONT }}>
      {active.map(c => {
        const p = campaignProgress(c)
        const secs = Math.max(0, Math.ceil((c.nextAt - now) / 1000))
        const running = c.status === 'running'
        return (
          <div key={c.id} role="status" style={{ background: `linear-gradient(135deg, ${C.inkSoft}, ${C.brand})`, color: C.onBrand, borderRadius: R.lg, padding: '12px 16px', boxShadow: SHADOW.pop, minWidth: '420px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <Icon name="megaphone" size={15} /> {c.name}
                  <span style={{ fontWeight: 600, opacity: 0.85 }}>· {p.done}/{p.total}</span>
                  {p.failed > 0 && <span style={{ color: '#F3B7A8', fontWeight: 700 }}>· {p.failed} falha(s)</span>}
                </div>
                <div style={{ fontSize: '11.5px', opacity: 0.85, marginTop: '2px', fontWeight: 500 }}>
                  {running
                    ? (secs > 0 ? `Próximo envio em ~${secs}s` : 'Enviando…')
                    : (c.pauseReason ?? 'Pausada')}
                </div>
              </div>
              {confirmStop === c.id ? (
                <>
                  <span style={{ fontSize: '12px', fontWeight: 700 }}>Parar de vez?</span>
                  <Btn danger icon="stop" onClick={() => { void sendToBackground({ type: 'CAMPAIGN_STOP', payload: { id: c.id } }); setConfirmStop(null) }}>Sim, parar</Btn>
                  <Btn onClick={() => setConfirmStop(null)}>Voltar</Btn>
                </>
              ) : (
                <>
                  {running
                    ? <Btn icon="pause" onClick={() => sendToBackground({ type: 'CAMPAIGN_PAUSE', payload: { id: c.id } })}>Pausar</Btn>
                    : <Btn primary icon="play" onClick={() => sendToBackground({ type: 'CAMPAIGN_RESUME', payload: { id: c.id } })}>Retomar</Btn>}
                  <Btn danger icon="stop" onClick={() => setConfirmStop(c.id)}>Parar</Btn>
                  {/* Botão recolher */}
                  <button
                    onClick={() => setCollapsed(true)}
                    title="Recolher"
                    style={{ width: '28px', height: '28px', borderRadius: R.sm, border: '1px solid rgba(247,244,237,0.3)', background: 'transparent', color: 'rgba(247,244,237,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <Icon name="chevronDown" size={14} />
                  </button>
                </>
              )}
            </div>
            <div style={{ height: '5px', background: 'rgba(247,244,237,0.2)', borderRadius: R.pill, marginTop: '10px' }}>
              <div style={{ height: '5px', width: `${p.total ? (p.done / p.total) * 100 : 0}%`, background: C.onBrand, borderRadius: R.pill, transition: 'width .3s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Btn({ children, onClick, primary, danger, icon }: { children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean; icon?: IconName }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: R.sm, fontSize: '12.5px', fontWeight: 800, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '6px',
        border: primary ? 'none' : `1px solid ${danger ? '#F3B7A8' : 'rgba(247,244,237,0.45)'}`,
        background: primary ? C.onBrand : 'transparent', color: primary ? C.brand : danger ? '#F3B7A8' : C.onBrand,
      }}
    >
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  )
}
