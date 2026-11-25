/**
 * "Visualizar campanha": o que vai acontecer antes de iniciar. Quem recebe, como a mensagem
 * chega, o que muda no Kanban, quanto tempo leva e os avisos. Não altera nada.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, Campaign, KanbanBoard, KanbanCard, KanbanColumn } from '../src/types'
import { getBoards, getCampaigns, getKanbanCards, getKanbanColumns, getSettings, STORAGE_KEYS as K } from '../src/storage'
import { watchStorage } from '../src/storageWatch'
import { buildCampaignPreview, formatDuration } from '../src/campaignPreview'
import { getImage } from '../src/images'
import { ImageThumb } from '../src/ImagePicker'
import { renderTemplate } from '../src/templates'
import { formatPhone } from '../src/phone'
import { C, R } from '../src/theme'
import { overlayStyle, modalStyle, ghostBtn, primaryBtn, errorStyle, warnStyle, okStyle, inputStyle } from '../src/ui'
import { Icon } from '../src/icons'

interface Data {
  campaigns: Campaign[]
  boards: KanbanBoard[]
  columns: Record<string, KanbanColumn[]>
  cards: Record<string, KanbanCard[]>
  settings: AppSettings
  hasImage: boolean
}

const LIST_LIMIT = 300
const title: React.CSSProperties = { margin: '0 0 8px', fontSize: '12px', fontWeight: 800, color: C.brand, textTransform: 'uppercase', letterSpacing: '0.05em' }
const bubble: React.CSSProperties = { background: '#E2F4D7', borderRadius: '10px 2px 10px 10px', padding: '8px', maxWidth: '360px', marginLeft: 'auto', fontSize: '13px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: C.ink }

export function CampaignPreviewModal({ campaign: c, onClose, onStart }: {
  campaign: Campaign
  onClose: () => void
  onStart?: () => void       // presente quando dá para iniciar ou retomar
}) {
  const [data, setData] = useState<Data | null>(null)
  const [variant, setVariant] = useState(0)
  const [contact, setContact] = useState(0)
  const [search, setSearch] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [campaigns, boards, settings, image] = await Promise.all([
        getCampaigns(), getBoards(), getSettings(), c.imageId ? getImage(c.imageId) : Promise.resolve(undefined),
      ])
      const columns: Data['columns'] = {}
      const cards: Data['cards'] = {}
      for (const b of boards) {
        columns[b.id] = await getKanbanColumns(b.id)
        cards[b.id] = await getKanbanCards(b.id)
      }
      if (alive) setData({ campaigns, boards, columns, cards, settings, hasImage: Boolean(image) })
    }
    void load()
    const stop = watchStorage([K.CAMPAIGNS, K.SETTINGS], () => { void load() }, 400)
    return () => { alive = false; stop() }
  }, [c.id, c.imageId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const preview = useMemo(() => (data ? buildCampaignPreview({ campaign: c, ...data }) : null), [c, data])

  const filtered = useMemo(() => {
    if (!preview) return []
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return preview.recipients
      .map((r, index) => ({ ...r, index }))
      .filter(r => !onlyProblems || r.problems.length)
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.stage.toLowerCase().includes(q) || (digits.length >= 3 && r.phone.includes(digits)))
  }, [preview, search, onlyProblems])

  const person = preview?.recipients[contact] ?? preview?.recipients[0]
  const message = renderTemplate(c.variants[variant] ?? '', { contactName: person?.name ?? '', vars: c.vars })
  const blocking = preview?.alerts.filter(a => a.level === 'stop') ?? []
  const withProblems = preview?.recipients.filter(r => r.problems.length).length ?? 0
  const ends = preview && new Date(Date.now() + preview.seconds * 1000)

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Visualizar campanha ${c.name}`} style={modalStyle(880)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: '17px', fontWeight: 800, color: C.brand }}>{c.name}</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        {!preview || !ends ? <div style={{ fontSize: '13px', color: C.muted }}>Montando a prévia…</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[
                ['Vão receber', String(preview.sending)],
                ['Duração estimada', preview.sending ? `cerca de ${formatDuration(preview.seconds)}` : '—'],
                ['Se iniciar agora, termina', preview.sending ? ends.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—'],
              ].map(([label, value]) => (
                <div key={label} style={{ border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', color: C.muted, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: '17px', fontWeight: 800 }}>{value}</div>
                </div>
              ))}
            </div>

            <section>
              <h3 style={title}>Confira antes de iniciar</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {preview.alerts.map(a => (
                  <div key={a.text} role={a.level === 'stop' ? 'alert' : undefined} style={{ ...(a.level === 'stop' ? errorStyle : warnStyle), display: 'flex', gap: '8px' }}>
                    <Icon name="alert" size={15} /> {a.text}
                  </div>
                ))}
                {preview.alerts.length === 0 && <div style={okStyle}>Nenhum problema encontrado.</div>}
              </div>
            </section>

            <section>
              <h3 style={title}>O que vai acontecer</h3>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.7 }}>
                {preview.actions.map(a => <li key={a}>{a}</li>)}
              </ol>
            </section>

            <section>
              <h3 style={title}>Como a mensagem chega</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                {c.variants.map((_, i) => (
                  <button key={i} onClick={() => setVariant(i)} aria-pressed={variant === i} style={variant === i ? primaryBtn() : ghostBtn}>Variação {i + 1}</button>
                ))}
                {person && <span style={{ fontSize: '12px', color: C.muted }}>como {person.name || formatPhone(person.phone)} vai receber (escolha outro na lista abaixo)</span>}
              </div>
              <div style={{ background: '#EFE7DD', borderRadius: R.md, padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={bubble}>
                  {c.imageId && <div style={{ marginBottom: '6px' }}><ImageThumb imageId={c.imageId} size={200} /></div>}
                  {message.text}
                </div>
                {c.link && (
                  <div style={bubble}>
                    {c.link.text}
                    {c.link.style === 'button'
                      ? <><div style={{ marginTop: '8px', borderTop: '1px solid #bcd9ae', paddingTop: '7px', textAlign: 'center', color: '#0B6CBF', fontWeight: 700 }}>{c.link.label}</div><div style={{ fontSize: '11px', color: C.muted, textAlign: 'center' }}>abre {c.link.url}</div></>
                      : <div style={{ color: '#0B6CBF' }}>{c.link.url}</div>}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 style={title}>Para quem vai ({preview.recipients.length})</h3>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="search" aria-label="Buscar na lista" style={{ ...inputStyle, maxWidth: '300px' }} placeholder="Nome, telefone ou etapa" value={search} onChange={e => setSearch(e.target.value)} />
                {withProblems > 0 && (
                  <label style={{ fontSize: '12px', fontWeight: 700, display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Só os com aviso ({withProblems})
                  </label>
                )}
              </div>
              <div style={{ maxHeight: '260px', overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R.md }}>
                <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: C.muted }}>
                      {['Ordem', 'Contato', 'Telefone', 'Onde está hoje', 'Aviso'].map(h => <th key={h} style={{ padding: '8px 10px', position: 'sticky', top: 0, background: C.surface }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, LIST_LIMIT).map(r => (
                      <tr key={`${r.phone}-${r.index}`} onClick={() => setContact(r.index)} style={{ borderTop: `1px solid ${C.line}`, cursor: 'pointer', background: contact === r.index ? C.accentSoft : undefined }}>
                        <td style={{ padding: '7px 10px' }}>{r.index + 1}</td>
                        <td style={{ padding: '7px 10px', fontWeight: 700 }}>{r.name || 'sem nome'}</td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{formatPhone(r.phone)}</td>
                        <td style={{ padding: '7px 10px' }}>{r.stage}</td>
                        <td style={{ padding: '7px 10px', color: C.danger }}>{r.problems.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > LIST_LIMIT && <div style={{ fontSize: '12px', color: C.muted, marginTop: '6px' }}>Mostrando {LIST_LIMIT} de {filtered.length}. Use a busca para achar os demais.</div>}
              {filtered.length === 0 && <div style={{ fontSize: '12px', color: C.muted, marginTop: '6px' }}>Nenhum contato com esse filtro.</div>}
            </section>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center' }}>
              {onStart && blocking.length > 0 && <span style={{ fontSize: '12px', fontWeight: 700, color: C.danger, flex: 1 }}>Há avisos em vermelho: confira antes de iniciar.</span>}
              <button style={ghostBtn} onClick={onClose}>Fechar</button>
              {onStart && preview.sending > 0 && (
                <button style={primaryBtn()} onClick={onStart}><Icon name="play" size={14} /> {c.status === 'draft' ? 'Iniciar' : 'Retomar'}</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
