import React, { useEffect, useMemo, useState } from 'react'
import type { Campaign, CampaignAudience, KanbanCard, KanbanColumn } from '../src/types'
import { sendToBackground } from '../src/types'
import { deleteCampaign, getCampaigns, getSettings, saveCampaign } from '../src/storage'
import { MIN_VARIANTS, buildItems, campaignProgress, validateCampaign } from '../src/campaign'
import { extraVariables, renderTemplate } from '../src/templates'
import { formatPhone } from '../src/phone'
import { C, FONT, R, SHADOW } from '../src/theme'
import {
  dangerBtn, errorStyle, ghostBtn, inputStyle, labelStyle, modalStyle, overlayStyle, primaryBtn, warnStyle, okStyle,
} from '../src/ui'
import { Icon } from '../src/icons'
import { useFeedback } from '../src/feedback'

const STATUS_LABEL: Record<Campaign['status'], { text: string; fg: string; bg: string }> = {
  draft: { text: 'Rascunho', fg: C.muted, bg: '#ECEAE0' },
  running: { text: 'Rodando', fg: C.ok, bg: C.okSoft },
  paused: { text: 'Pausada', fg: C.warn, bg: C.warnSoft },
  stopped: { text: 'Interrompida', fg: C.danger, bg: C.dangerSoft },
  done: { text: 'Concluída', fg: C.info, bg: C.infoSoft },
}

export function CampaignsPanel({ columns, cards }: { columns: KanbanColumn[]; cards: KanbanCard[] }) {
  const { toast, confirm } = useFeedback()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showForm, setShowForm] = useState(false)
  const [reportId, setReportId] = useState<string | null>(null)

  useEffect(() => {
    const load = () => { void getCampaigns().then(list => setCampaigns([...list].sort((a, b) => b.createdAt - a.createdAt))) }
    load()
    chrome.storage.onChanged.addListener(load)
    return () => chrome.storage.onChanged.removeListener(load)
  }, [])

  async function act(promise: Promise<{ ok: boolean; message?: string }>, okMessage?: string) {
    const r = await promise
    if (!r.ok) toast(r.message ?? 'Não foi possível concluir a ação.', 'err')
    else if (okMessage) toast(okMessage)
  }

  async function start(c: Campaign) {
    const pending = c.items.filter(i => i.status === 'pending').length
    const ok = await confirm({
      title: `Iniciar "${c.name}"?`,
      message: `${pending} contato(s), com intervalo de ${c.minSec} a ${c.maxSec} segundos entre mensagens.\n\nA aba do WhatsApp Web precisa ficar aberta e conectada durante toda a campanha. Você pode pausar ou parar pela barra que aparece no WhatsApp Web.`,
      confirmLabel: 'Iniciar campanha',
    })
    if (ok) await act(sendToBackground({ type: 'CAMPAIGN_START', payload: { id: c.id } }), 'Campanha iniciada.')
  }

  async function remove(c: Campaign) {
    const ok = await confirm({ title: 'Excluir campanha', message: `Excluir "${c.name}" e o relatório dela?`, confirmLabel: 'Excluir', danger: true })
    if (ok) {
      await deleteCampaign(c.id)
      toast('Campanha excluída.')
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 22px 40px', fontFamily: FONT }}>
      <div style={{ maxWidth: '980px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: C.brand }}>Campanhas</h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: C.muted }}>Disparo com intervalos aleatórios e variações de texto, com travas de segurança.</p>
          </div>
          <button style={primaryBtn()} onClick={() => setShowForm(true)}><Icon name="plus" size={16} /> Nova campanha</button>
        </div>

        <div style={{ ...warnStyle, display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '16px', lineHeight: 1.5 }}>
          <Icon name="alert" size={18} style={{ marginTop: '1px' }} />
          <span>
            Disparo em massa viola os termos do WhatsApp e pode causar bloqueio da conta. Variações de texto e intervalos aleatórios reduzem o risco, mas não o eliminam.
            Evite números que nunca conversaram com você e respeite quem pedir para parar.
          </span>
        </div>

        {campaigns.length === 0 && (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: C.muted, background: C.surface, borderRadius: R.lg, border: `1px dashed ${C.lineStrong}` }}>
            <div style={{ width: '52px', height: '52px', margin: '0 auto 12px', borderRadius: '50%', background: C.accentSoft, color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="megaphone" size={26} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 800, color: C.inkSoft }}>Nenhuma campanha ainda</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>Crie a primeira escolhendo um público do Kanban ou colando uma lista de telefones.</div>
          </div>
        )}

        {campaigns.map(c => {
          const p = campaignProgress(c)
          const st = STATUS_LABEL[c.status]
          return (
            <div key={c.id} style={{ background: C.surface, borderRadius: R.lg, padding: '16px 18px', marginBottom: '12px', boxShadow: SHADOW.card, border: `1px solid ${C.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '15px', color: C.ink }}>{c.name}</strong>
                <span style={{ fontSize: '11px', fontWeight: 800, color: st.fg, background: st.bg, borderRadius: R.pill, padding: '2px 10px' }}>{st.text}</span>
                <span style={{ fontSize: '12px', color: C.muted, flex: 1, fontWeight: 600 }}>
                  {p.sent} enviadas · {p.failed} falhas · {p.pending} pendentes · {c.minSec}–{c.maxSec}s
                </span>
                {c.status === 'draft' && <button style={primaryBtn()} onClick={() => start(c)}><Icon name="play" size={14} /> Iniciar</button>}
                {(c.status === 'paused' || c.status === 'stopped') && p.pending > 0 && (
                  <button style={primaryBtn()} onClick={() => act(sendToBackground({ type: 'CAMPAIGN_RESUME', payload: { id: c.id } }))}><Icon name="play" size={14} /> Retomar</button>
                )}
                {c.status === 'running' && <button style={ghostBtn} onClick={() => act(sendToBackground({ type: 'CAMPAIGN_PAUSE', payload: { id: c.id } }))}><Icon name="pause" size={14} /> Pausar</button>}
                {(c.status === 'running' || c.status === 'paused') && (
                  <button style={dangerBtn} onClick={async () => { if (await confirm({ title: 'Parar campanha', message: 'Os contatos pendentes não serão enviados.', confirmLabel: 'Parar', danger: true })) void act(sendToBackground({ type: 'CAMPAIGN_STOP', payload: { id: c.id } })) }}>
                    <Icon name="stop" size={14} /> Parar
                  </button>
                )}
                <button style={ghostBtn} onClick={() => setReportId(reportId === c.id ? null : c.id)}><Icon name="list" size={14} /> Relatório</button>
                {c.status !== 'running' && (
                  <button style={dangerBtn} onClick={() => remove(c)} aria-label={`Excluir ${c.name}`} title="Excluir"><Icon name="trash" size={14} /></button>
                )}
              </div>
              {c.pauseReason && c.status !== 'running' && <div style={{ ...warnStyle, marginTop: '10px' }}>{c.pauseReason}</div>}
              <div style={{ height: '6px', background: '#ECEAE0', borderRadius: R.pill, marginTop: '12px' }} role="progressbar" aria-valuenow={p.done} aria-valuemax={p.total} aria-label="Progresso da campanha">
                <div style={{ height: '6px', width: `${p.total ? (p.done / p.total) * 100 : 0}%`, background: C.accent, borderRadius: R.pill, transition: 'width .3s' }} />
              </div>

              {reportId === c.id && (
                <div style={{ overflowX: 'auto', marginTop: '14px' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: C.muted }}>
                        <th style={th}>Contato</th><th style={th}>Telefone</th><th style={th}>Status</th><th style={th}>Variação</th><th style={th}>Detalhe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.items.map((it, i) => (
                        <tr key={`${it.phone}-${i}`} style={{ borderTop: `1px solid ${C.line}` }}>
                          <td style={{ ...td, fontWeight: 700 }}>{it.name}</td>
                          <td style={td}>{formatPhone(it.phone)}</td>
                          <td style={td}>{{ pending: 'Pendente', sending: 'Enviando', sent: 'Enviado', failed: 'Falhou' }[it.status]}</td>
                          <td style={td}>{it.variantIdx !== undefined ? it.variantIdx + 1 : '—'}</td>
                          <td style={{ ...td, color: it.error ? C.danger : C.muted }}>{it.error ?? (it.sentAt ? new Date(it.sentAt).toLocaleTimeString('pt-BR') : '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showForm && (
        <CampaignForm
          columns={columns}
          cards={cards}
          onClose={() => setShowForm(false)}
          onSaved={async (c, startNow) => {
            setShowForm(false)
            toast('Campanha salva.')
            if (startNow) await start(c)
          }}
        />
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '8px 10px' }

const fieldset: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R.md, padding: '12px 14px', margin: 0 }
const legend: React.CSSProperties = { fontSize: '12px', fontWeight: 800, color: C.brand, padding: '0 6px' }

function CampaignForm({
  columns, cards, onClose, onSaved,
}: {
  columns: KanbanColumn[]
  cards: KanbanCard[]
  onClose: () => void
  onSaved: (c: Campaign, startNow: boolean) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CampaignAudience['kind']>('kanban')
  const [columnId, setColumnId] = useState('')
  const [tag, setTag] = useState('')
  const [pasted, setPasted] = useState('')
  const [variants, setVariants] = useState<string[]>(Array(MIN_VARIANTS).fill(''))
  const [vars, setVars] = useState<Record<string, string>>({})
  const [minSec, setMinSec] = useState(20)
  const [maxSec, setMaxSec] = useState(45)
  const [moveTo, setMoveTo] = useState('')
  const [floor, setFloor] = useState(15)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => { void getSettings().then(s => { setFloor(s.campaignMinFloorSec); setMinSec(m => Math.max(m, s.campaignMinFloorSec)) }) }, [])

  const tags = useMemo(() => [...new Set(cards.flatMap(c => c.tags))].sort(), [cards])
  const audience: CampaignAudience = kind === 'pasted'
    ? { kind }
    : { kind, columnId: columnId || undefined, tag: tag || undefined }

  const { items, invalidLines } = useMemo(
    () => buildItems({ audience, cards, pastedText: pasted }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, columnId, tag, pasted, cards]
  )

  const extras = useMemo(() => [...new Set(variants.flatMap(v => extraVariables(v)))], [variants])
  const firstFilled = variants.find(v => v.trim())
  const preview = firstFilled && items[0]
    ? renderTemplate(firstFilled, { contactName: items[0].name, vars }).text
    : null
  const filledCount = variants.filter(v => v.trim()).length

  async function save(startNow: boolean) {
    const draft = { name, variants, vars, minSec, maxSec, items }
    const problems = validateCampaign(draft, floor)
    if (kind !== 'pasted' && !columnId && !tag) problems.unshift('Escolha uma coluna ou tag do Kanban (ou use lista colada).')
    setErrors(problems)
    if (problems.length > 0) return
    const now = Date.now()
    const campaign: Campaign = {
      id: `camp_${now}_${Math.random().toString(36).slice(2)}`,
      name: name.trim(),
      audience,
      variants: variants.map(v => v.trim()).filter(Boolean),
      vars,
      minSec,
      maxSec,
      moveToColumnId: moveTo || undefined,
      status: 'draft',
      consecutiveFailures: 0,
      nextAt: 0,
      items,
      createdAt: now,
      updatedAt: now,
    }
    await saveCampaign(campaign)
    await onSaved(campaign, startNow)
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Nova campanha" style={modalStyle(680)}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: '17px', fontWeight: 800, color: C.brand }}>Nova campanha</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={labelStyle}>
            Nome da campanha
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Retomada de leads Lisboa" autoFocus />
          </label>

          <fieldset style={fieldset}>
            <legend style={legend}>1. Público</legend>
            <div style={{ display: 'flex', gap: '18px', fontSize: '13px', marginBottom: '10px', fontWeight: 600 }}>
              {(['kanban', 'pasted', 'both'] as const).map(k => (
                <label key={k} style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="radio" name="aud" checked={kind === k} onChange={() => setKind(k)} />
                  {{ kanban: 'Do Kanban', pasted: 'Lista colada', both: 'Os dois' }[k]}
                </label>
              ))}
            </div>
            {kind !== 'pasted' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <label style={labelStyle}>
                  Coluna
                  <select style={inputStyle} value={columnId} onChange={e => setColumnId(e.target.value)}>
                    <option value="">Qualquer</option>
                    {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Tag
                  <select style={inputStyle} value={tag} onChange={e => setTag(e.target.value)}>
                    <option value="">Qualquer</option>
                    {tags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
            )}
            {kind !== 'kanban' && (
              <label style={labelStyle}>
                Lista colada (uma por linha: “nome;telefone” ou só o telefone)
                <textarea style={{ ...inputStyle, minHeight: '84px', resize: 'vertical' }} value={pasted} onChange={e => setPasted(e.target.value)} placeholder={'Maria Silva;(31) 99999-1111\n(31) 98888-2222'} />
              </label>
            )}
            <div style={{ ...(items.length ? okStyle : warnStyle), marginTop: '10px' }}>
              {items.length} contato(s) válidos, sem duplicados
              {invalidLines.length > 0 && ` · ${invalidLines.length} linha(s) ignorada(s) por telefone inválido`}
            </div>
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>2. Variações da mensagem ({filledCount}/{MIN_VARIANTS} mínimas)</legend>
            <p style={{ margin: '0 0 10px', fontSize: '12px', color: C.muted, lineHeight: 1.5 }}>
              Cada contato recebe uma variação sorteada. Use {'{primeiro_nome}'}, {'{nome}'}, {'{data}'} ou suas {'{variáveis}'}; todas as variações devem usar as mesmas.
            </p>
            {variants.map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                <textarea
                  style={{ ...inputStyle, minHeight: '52px', resize: 'vertical' }}
                  value={v}
                  placeholder={`Variação ${i + 1}`}
                  aria-label={`Variação ${i + 1}`}
                  onChange={e => setVariants(variants.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {variants.length > MIN_VARIANTS && (
                  <button style={dangerBtn} onClick={() => setVariants(variants.filter((_, j) => j !== i))} aria-label={`Remover variação ${i + 1}`}><Icon name="x" size={14} /></button>
                )}
              </div>
            ))}
            {variants.length < 10 && <button style={ghostBtn} onClick={() => setVariants([...variants, ''])}><Icon name="plus" size={14} /> Adicionar variação</button>}

            {extras.map(v => (
              <label key={v} style={{ ...labelStyle, marginTop: '10px' }}>
                {`{${v}}`} (igual para todos)
                <input style={inputStyle} value={vars[v] ?? ''} onChange={e => setVars({ ...vars, [v]: e.target.value })} />
              </label>
            ))}
            {preview && (
              <div style={{ marginTop: '12px', background: C.accentSoft, border: `1px solid ${C.accentLine}`, borderRadius: R.md, padding: '10px 12px', fontSize: '12.5px', whiteSpace: 'pre-wrap', color: C.inkSoft }}>
                <strong style={{ color: C.brand }}>Prévia (1ª variação, 1º contato)</strong>{'\n'}{preview}
              </div>
            )}
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>3. Ritmo e segurança</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: '10px' }}>
              <label style={labelStyle}>
                Intervalo mínimo (s)
                <input type="number" min={floor} style={inputStyle} value={minSec} onChange={e => setMinSec(Number(e.target.value))} />
              </label>
              <label style={labelStyle}>
                Intervalo máximo (s)
                <input type="number" min={minSec} style={inputStyle} value={maxSec} onChange={e => setMaxSec(Number(e.target.value))} />
              </label>
              <label style={labelStyle}>
                Mover card após enviar
                <select style={inputStyle} value={moveTo} onChange={e => setMoveTo(e.target.value)}>
                  <option value="">Não mover</option>
                  {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.muted, lineHeight: 1.5 }}>
              Cada envio espera um tempo aleatório entre o mínimo e o máximo (piso de {floor}s). Vale o limite diário da conta. A campanha pausa sozinha após falhas seguidas ou aviso de restrição, e você pode pausar ou parar pela barra no WhatsApp Web.
            </p>
          </fieldset>

          {errors.length > 0 && (
            <div role="alert" style={errorStyle}>
              {errors.map(e => <div key={e}>• {e}</div>)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={{ ...ghostBtn, flex: 1 }} onClick={() => save(false)}>Salvar rascunho</button>
            <button style={{ ...primaryBtn(), flex: 1 }} onClick={() => save(true)}><Icon name="play" size={14} /> Salvar e iniciar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
