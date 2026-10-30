/**
 * Camada da extensão dentro do WhatsApp Web, em Shadow DOM (isola o CSS da página).
 * Contém: dock de ações (UP), painel do contato, modais, banner de envio,
 * respostas rápidas e barra de controle de campanha.
 */

import { createRoot } from 'react-dom/client'
import React from 'react'
import type { ActiveSend } from '../src/types'
import { sendToBackground } from '../src/types'
import { getScheduledMessages, getTasks } from '../src/storage'
import { BASE_CSS, C, FONT, R, SHADOW, brandUrl } from '../src/theme'
import { Icon, type IconName } from '../src/icons'
import { SchedulerModal } from './SchedulerModal'
import { QuickAddModal } from './QuickAddModal'
import { SendBanner } from './SendBanner'
import { ContactPanel } from './ContactPanel'
import { QuickReplies } from './QuickReplies'
import { CampaignBar } from './CampaignBar'
import { getCurrentContact, type CurrentContact } from './whatsapp-bridge'

export const FloatingButton = {
  mount() {
    const host = document.createElement('div')
    host.id = 'wm-root'
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = BASE_CSS
    const container = document.createElement('div')
    container.style.fontFamily = FONT
    shadow.append(style, container)
    createRoot(container).render(React.createElement(FloatingApp))
  },
}

type Modal = 'scheduler' | 'quickadd' | null

const DOCK_KEY = 'wm_dock_open'

function readDockOpen(): boolean {
  try { return localStorage.getItem(DOCK_KEY) === '1' } catch { return false }
}

function FloatingApp() {
  const [modal, setModal] = React.useState<Modal>(null)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [dockOpen, setDockOpen] = React.useState(readDockOpen)
  const [contact, setContact] = React.useState<CurrentContact | null>(null)
  const [job, setJob] = React.useState<ActiveSend | null>(null)
  const [pending, setPending] = React.useState(0)
  const contactRef = React.useRef<CurrentContact | null>(null)

  // Envio em andamento (o background abriu este chat por número)
  React.useEffect(() => {
    void sendToBackground<ActiveSend | null>({ type: 'GET_ACTIVE_SEND' }).then(r => {
      if (r.ok && r.data) setJob(r.data)
    })
  }, [])

  // Conversa aberta
  React.useEffect(() => {
    const read = () => {
      const c = getCurrentContact()
      contactRef.current = c
      setContact(prev => (prev?.name === c?.name && prev?.phone === c?.phone ? prev : c))
    }
    read()
    const interval = setInterval(read, 1500)
    return () => clearInterval(interval)
  }, [])

  // Selo: follow-ups vencidos + tarefas vencidas
  React.useEffect(() => {
    const load = async () => {
      const now = Date.now()
      const [msgs, tasks] = await Promise.all([getScheduledMessages(), getTasks()])
      setPending(
        msgs.filter(m => m.status === 'pending' && m.scheduledAt <= now).length +
        tasks.filter(t => !t.done && t.dueAt <= now).length
      )
    }
    void load()
    chrome.storage.onChanged.addListener(load)
    const t = setInterval(load, 30_000)
    return () => { chrome.storage.onChanged.removeListener(load); clearInterval(t) }
  }, [])

  function toggleDock(next: boolean) {
    setDockOpen(next)
    try { localStorage.setItem(DOCK_KEY, next ? '1' : '0') } catch { /* sem armazenamento */ }
  }

  React.useEffect(() => {
    if (!dockOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleDock(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dockOpen])

  const items: { icon: IconName; label: string; hint: string; run: () => void; active?: boolean }[] = [
    { icon: 'user', label: 'Painel do contato', hint: 'Etapa, tags, notas e tarefas', run: () => setPanelOpen(!panelOpen), active: panelOpen },
    { icon: 'calendar', label: 'Agendar follow-up', hint: 'Programe uma mensagem', run: () => setModal('scheduler') },
    { icon: 'userPlus', label: 'Salvar no Kanban', hint: 'Adicione esta conversa', run: () => setModal('quickadd') },
    { icon: 'kanban', label: 'Abrir Kanban', hint: 'Seu funil de leads', run: () => void sendToBackground({ type: 'OPEN_KANBAN' }) },
    { icon: 'megaphone', label: 'Campanhas', hint: 'Disparo com variações', run: () => void sendToBackground({ type: 'OPEN_KANBAN', payload: { hash: 'campanhas' } }) },
    { icon: 'book', label: 'Manual de uso', hint: 'Passo a passo do time', run: () => void sendToBackground({ type: 'OPEN_MANUAL' }) },
  ]

  return (
    <>
      <div
        style={{
          position: 'fixed', right: panelOpen ? '320px' : 0, top: '36%', zIndex: 99999,
          display: 'flex', alignItems: 'flex-start', gap: '8px', fontFamily: FONT,
        }}
      >
        {dockOpen && (
          <nav
            aria-label="Ações UP"
            style={{ background: C.surface, borderRadius: R.lg, boxShadow: SHADOW.dock, padding: '8px', width: '248px', border: `1px solid ${C.line}` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px 10px' }}>
              <img src={brandUrl('logo-up-verde.png')} alt="UP" style={{ height: '16px' }} />
              <span style={{ fontSize: '11px', fontWeight: 800, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Follow-up</span>
            </div>
            {items.map(it => (
              <button
                key={it.label}
                onClick={() => { it.run(); toggleDock(false) }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 10px', border: 'none',
                  borderRadius: R.sm, background: it.active ? C.accentSoft : 'transparent', textAlign: 'left', color: C.ink, fontFamily: FONT,
                }}
                onMouseEnter={e => { if (!it.active) e.currentTarget.style.background = '#F3F1E8' }}
                onMouseLeave={e => { if (!it.active) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: '32px', height: '32px', borderRadius: R.sm, background: C.brand, color: C.onBrand, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={it.icon} size={17} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  <span style={{ fontSize: '13px', fontWeight: 700 }}>{it.label}</span>
                  <span style={{ fontSize: '11px', color: C.muted, fontWeight: 500 }}>{it.hint}</span>
                </span>
              </button>
            ))}
          </nav>
        )}

        <button
          onClick={() => toggleDock(!dockOpen)}
          aria-label={dockOpen ? 'Recolher menu UP' : 'Abrir menu UP'}
          aria-expanded={dockOpen}
          title="UP · Follow-up"
          style={{
            position: 'relative', width: '40px', height: '64px', border: 'none', borderRadius: `${R.md} 0 0 ${R.md}`,
            background: `linear-gradient(160deg, ${C.inkSoft}, ${C.brand})`, boxShadow: SHADOW.dock,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <img src={brandUrl('logo-up-offwhite.png')} alt="" style={{ width: '22px' }} />
          {pending > 0 && (
            <span style={{ position: 'absolute', top: '-6px', left: '-6px', minWidth: '20px', height: '20px', padding: '0 5px', borderRadius: R.pill, background: C.danger, color: '#fff', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
              {pending}
            </span>
          )}
        </button>
      </div>

      {panelOpen && (
        <ContactPanel
          contact={contact}
          onClose={() => setPanelOpen(false)}
          onSchedule={() => setModal('scheduler')}
          onQuickAdd={() => setModal('quickadd')}
        />
      )}

      {modal === 'scheduler' && <SchedulerModal contact={contact} onClose={() => setModal(null)} />}
      {modal === 'quickadd' && <QuickAddModal contact={contact} onClose={() => setModal(null)} />}
      {job && <SendBanner job={job} onFinish={() => setJob(null)} />}
      <QuickReplies getContact={() => contactRef.current} />
      <CampaignBar />
    </>
  )
}
