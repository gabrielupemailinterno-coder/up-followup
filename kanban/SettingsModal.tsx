import React, { useEffect, useRef, useState } from 'react'
import type { AppSettings, CrmAgentMode, GeminiStatus, KanbanColumn, Template } from '../src/types'
import { sendToBackground } from '../src/types'
import { getSettings, getTemplates, saveSettings, saveTemplates, getTodayLog, getGeminiUserKey, setGeminiUserKey, getCrmStages, getKanbanColumns } from '../src/storage'
import { columnForStage, normTitle } from '../src/crmSync'
import { buildBackup, buildKanbanCsv, downloadFile, restoreBackup } from '../src/backup'
import { C, R } from '../src/theme'
import {
  overlayStyle, modalStyle, labelStyle, inputStyle, primaryBtn, ghostBtn, dangerBtn, warnStyle,
} from '../src/ui'
import { Icon } from '../src/icons'
import { CRM_ACTIVITY_TYPES } from '../src/crm'
import { explainWppError, type WppResult, type WppStatus } from '../src/wpp'
import { useFeedback } from '../src/feedback'

const sectionStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R.md, padding: '14px 16px', marginTop: '14px' }
const h3: React.CSSProperties = { margin: '0 0 10px', fontSize: '13px', fontWeight: 800, color: C.brand }
type SettingsTab = 'envios' | 'crm' | 'gemini' | 'templates' | 'dados'
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'envios', label: 'Envios e WhatsApp' },
  { id: 'crm', label: 'CRM Incbook' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'templates', label: 'Templates' },
  { id: 'dados', label: 'Backup' },
]

const help: React.CSSProperties = { fontSize: '12px', color: C.muted, margin: '8px 0 0', lineHeight: 1.5 }

export function SettingsModal({
  onClose, onDataChanged, onResetColumns,
}: {
  onClose: () => void
  onDataChanged: () => void
  onResetColumns: () => void
}) {
  const { toast, confirm } = useFeedback()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [usedToday, setUsedToday] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [wpp, setWpp] = useState<{ busy: boolean; result?: WppResult<WppStatus>; failure?: string }>({ busy: false })
  const [tab, setTab] = useState<SettingsTab>('envios')
  const [gemKey, setGemKey] = useState('')
  const [crmStages, setCrmStagesState] = useState<string[]>([])
  const [kColumns, setKColumns] = useState<KanbanColumn[]>([])
  const [gemStatus, setGemStatus] = useState<GeminiStatus | null>(null)
  const [gemTest, setGemTest] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false })

  async function refreshGemini() {
    const r = await sendToBackground<GeminiStatus>({ type: 'GEMINI_STATUS' })
    if (r.ok && r.data) setGemStatus(r.data)
  }

  useEffect(() => {
    void (async () => {
      const [s, t, log] = await Promise.all([getSettings(), getTemplates(), getTodayLog()])
      setSettings(s)
      setTemplates(t)
      setUsedToday(log.count)
      setGemKey(await getGeminiUserKey())
      setCrmStagesState(await getCrmStages())
      setKColumns(await getKanbanColumns())
      void refreshGemini()
    })()
  }, [])

  if (!settings) return null

  function num(v: string, min: number, fallback: number) {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n >= min ? n : fallback
  }

  async function saveAll() {
    if (!settings) return
    const cleaned = templates.filter(t => t.title.trim() && t.body.trim())
    await saveSettings(settings)
    await setGeminiUserKey(gemKey)
    await refreshGemini()
    await saveTemplates(cleaned)
    setTemplates(cleaned)
    await sendToBackground({ type: 'RESYNC_ALARMS' })
    toast(settings.crmEnabled ? (settings.crmDryRun ? 'Configurações salvas. CRM: ligado em modo teste.' : 'Configurações salvas. CRM: ligado, registra de verdade.') : 'Configurações salvas. CRM: desligado.')
  }

  async function exportJson() {
    const backup = await buildBackup()
    downloadFile(`up-followup-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json')
    toast('Backup exportado.')
  }

  async function exportCsv() {
    downloadFile(`up-kanban-${new Date().toISOString().slice(0, 10)}.csv`, await buildKanbanCsv(), 'text/csv;charset=utf-8')
    toast('CSV exportado.')
  }

  async function importJson(file: File) {
    try {
      const raw = JSON.parse(await file.text())
      const ok = await confirm({
        title: 'Importar backup',
        message: 'A importação substitui TODOS os dados atuais: cards, colunas, agendamentos, templates, campanhas, tarefas e configurações. Deseja continuar?',
        confirmLabel: 'Importar e substituir',
        danger: true,
      })
      if (!ok) return
      await restoreBackup(raw)
      await sendToBackground({ type: 'RESYNC_ALARMS' })
      onDataChanged()
      const [s, t] = await Promise.all([getSettings(), getTemplates()])
      setSettings(s)
      setTemplates(t)
      toast('Backup restaurado.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao importar o arquivo.', 'err')
    }
  }

  async function testWpp() {
    setWpp({ busy: true })
    const r = await sendToBackground<WppResult<WppStatus>>({ type: 'WPP_STATUS' })
    if (!r.ok) setWpp({ busy: false, failure: r.message })
    else setWpp({ busy: false, result: r.data })
  }

  async function testGemini() {
    setGemTest({ busy: true })
    await saveSettings(settings!)
    await setGeminiUserKey(gemKey)
    const r = await sendToBackground<{ text: string }>({ type: 'GEMINI_TEST' })
    setGemTest(r.ok ? { busy: false, ok: true, text: 'Conexão com o Gemini funcionando.' } : { busy: false, ok: false, text: r.message })
    void refreshGemini()
  }

  function patchTemplate(id: string, patch: Partial<Template>) {
    setTemplates(templates.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Configurações" style={modalStyle(600)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: C.brand }}>Configurações</h2>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: C.muted, display: 'flex' }}><Icon name="x" size={20} /></button>
        </div>
        <nav role="tablist" aria-label="Seções das configurações" style={{ display: 'flex', gap: '4px', marginTop: '12px', borderBottom: `1px solid ${C.line}`, overflowX: 'auto' }}>
          {SETTINGS_TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              style={{ background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.id ? C.brand : 'transparent'}`, padding: '8px 10px', fontSize: '13px', fontWeight: tab === t.id ? 800 : 600, color: tab === t.id ? C.brand : C.muted, whiteSpace: 'nowrap', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'envios' && (
        <section style={sectionStyle}>
          <h3 style={h3}>Proteção da conta</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <label style={labelStyle}>
              Limite diário de envios
              <input type="number" min={1} style={inputStyle} value={settings.dailyLimit}
                onChange={e => setSettings({ ...settings, dailyLimit: num(e.target.value, 1, 30) })} />
            </label>
            <label style={labelStyle}>
              Intervalo entre follow-ups (s)
              <input type="number" min={0} style={inputStyle} value={settings.minIntervalSec}
                onChange={e => setSettings({ ...settings, minIntervalSec: num(e.target.value, 0, 60) })} />
            </label>
            <label style={labelStyle}>
              Avisar antes (min)
              <input type="number" min={0} style={inputStyle} value={settings.notifyBeforeMinutes}
                onChange={e => setSettings({ ...settings, notifyBeforeMinutes: num(e.target.value, 0, 5) })} />
            </label>
            <label style={labelStyle}>
              Pausar campanha após falhas
              <input type="number" min={1} style={inputStyle} value={settings.maxConsecutiveFailures}
                onChange={e => setSettings({ ...settings, maxConsecutiveFailures: num(e.target.value, 1, 3) })} />
            </label>
            <label style={labelStyle}>
              Piso do intervalo da campanha (s)
              <input type="number" min={5} style={inputStyle} value={settings.campaignMinFloorSec}
                onChange={e => setSettings({ ...settings, campaignMinFloorSec: num(e.target.value, 5, 15) })} />
            </label>
          </div>
          <p style={help}>
            Hoje você já enviou <strong>{usedToday}</strong> mensagem(ns). O intervalo mínimo vale para follow-ups agendados; as campanhas usam o intervalo próprio definido nelas.
          </p>
          <div style={{ ...warnStyle, marginTop: '10px' }}>
            Mesmo com limites, volume alto e textos idênticos para números frios aumentam o risco de bloqueio da conta.
          </div>
        </section>
        )}

        {tab === 'crm' && (
        <section style={sectionStyle}>
          <h3 style={h3}>CRM Incbook</h3>
          <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', fontWeight: 600, marginBottom: '10px', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.crmEnabled} onChange={e => setSettings({ ...settings, crmEnabled: e.target.checked })} style={{ marginTop: '3px', accentColor: C.brand }} />
            <span>Registrar a atividade no CRM depois de cada envio<br /><span style={{ fontWeight: 500, color: C.muted, fontSize: '12px' }}>Follow-ups e campanhas viram atividade no lead certo, como se o corretor tivesse lançado.</span></span>
          </label>
          <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', fontWeight: 600, marginBottom: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.crmDryRun} onChange={e => setSettings({ ...settings, crmDryRun: e.target.checked })} style={{ marginTop: '3px', accentColor: C.brand }} />
            <span>Modo teste (preenche o formulário, mas NÃO envia)<br /><span style={{ fontWeight: 500, color: C.muted, fontSize: '12px' }}>Deixe ligado até validar em um lead de teste. Desligue para registrar de verdade.</span></span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label style={labelStyle}>
              Tipo na 1ª mensagem ao lead
              <select style={inputStyle} value={settings.crmFirstType} onChange={e => setSettings({ ...settings, crmFirstType: e.target.value })}>
                {[...new Set([settings.crmFirstType, ...CRM_ACTIVITY_TYPES])].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Tipo nas mensagens seguintes
              <select style={inputStyle} value={settings.crmFollowupType} onChange={e => setSettings({ ...settings, crmFollowupType: e.target.value })}>
                {[...new Set([settings.crmFollowupType, ...CRM_ACTIVITY_TYPES])].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>
          <p style={help}>
            A extensão abre uma aba do CRM fixada, em segundo plano, só para isso (você precisa estar logado no CRM neste navegador). Ela acha o lead pelo telefone, confere o telefone no painel e só então registra. Se houver mais de um lead com o mesmo telefone, ou o telefone não conferir, não registra e avisa na aba CRM do ícone UP.
          </p>
          <h4 style={{ ...h3, marginTop: '16px' }}>Sincronização com o Kanban</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
            <label style={labelStyle}>
              Meu nome no CRM (como aparece em "Com quem está")
              <input style={inputStyle} value={settings.crmOwnerName} placeholder="Ex.: Gabriel Vieira" onChange={e => setSettings({ ...settings, crmOwnerName: e.target.value })} />
            </label>
            <label style={labelStyle}>
              Páginas lidas (máx.)
              <input type="number" min={1} style={inputStyle} value={settings.crmSyncMaxPages} onChange={e => setSettings({ ...settings, crmSyncMaxPages: num(e.target.value, 1, 80) })} />
            </label>
          </div>
          <p style={help}>
            O botão <strong>Sincronizar CRM</strong> no Kanban lê a tela Leads do CRM (ative em "Colunas" as colunas <em>Telefone</em>, <em>Etapa</em> e <em>Com quem está</em>), traz só os seus leads e coloca cada um na coluna da etapa. Ao arrastar no Kanban um card que veio do CRM, a extensão pergunta se deve mudar a etapa no CRM também.
          </p>
          {crmStages.length > 0 && (
            <table style={{ width: '100%', marginTop: '10px', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ textAlign: 'left', padding: '4px', color: C.muted }}>Etapa no CRM</th><th style={{ textAlign: 'left', padding: '4px', color: C.muted }}>Coluna no Kanban</th></tr></thead>
              <tbody>
                {crmStages.map(stage => {
                  const key = normTitle(stage)
                  const auto = columnForStage(stage, kColumns, {})
                  return (
                    <tr key={key} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: '6px 4px', fontWeight: 600 }}>{stage}</td>
                      <td style={{ padding: '4px' }}>
                        <select style={inputStyle} value={settings.crmStageMap[key] ?? ''} onChange={e => {
                          const map = { ...settings.crmStageMap }
                          if (e.target.value) map[key] = e.target.value; else delete map[key]
                          setSettings({ ...settings, crmStageMap: map })
                        }}>
                          <option value="">Automático{auto ? ` (${auto.title})` : ' (cria coluna)'}</option>
                          {kColumns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div style={{ ...warnStyle, marginTop: '10px' }}>
            Teste primeiro: com o modo teste ligado, envie uma mensagem para um lead de teste e veja o resultado na aba CRM. Só depois desligue o modo teste.
          </div>
        </section>
        )}

        {tab === 'gemini' && (
        <section style={sectionStyle}>
          <h3 style={h3}>Piloto Gemini (CRM)</h3>
          <p style={{ ...help, margin: '0 0 10px' }}>
            O Gemini lê a tela do CRM e escolhe o próximo clique, como uma pessoa faria. A extensão valida cada ação: só grava depois de conferir o telefone do lead, digita ela mesma o comentário, respeita o modo teste e bloqueia ações perigosas (excluir, mover, enviar lead).
          </p>
          <label style={labelStyle}>
            Quem conduz o registro no CRM
            <select style={inputStyle} value={settings.crmAgent} onChange={e => setSettings({ ...settings, crmAgent: e.target.value as CrmAgentMode })}>
              <option value="pilot">Gemini conduz (recomendado); fluxo fixo se o Gemini falhar</option>
              <option value="fallback">Fluxo fixo primeiro; Gemini só se ele falhar antes de enviar</option>
              <option value="off">Só o fluxo fixo (sem Gemini)</option>
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
            <label style={labelStyle}>
              Modelo do Gemini
              <input style={inputStyle} value={settings.geminiModel} onChange={e => setSettings({ ...settings, geminiModel: e.target.value.trim() })} />
            </label>
            <label style={labelStyle}>
              Limite de chamadas por dia
              <input type="number" min={1} style={inputStyle} value={settings.geminiDailyLimit}
                onChange={e => setSettings({ ...settings, geminiDailyLimit: num(e.target.value, 1, 400) })} />
            </label>
          </div>
          <label style={{ ...labelStyle, marginTop: '10px' }}>
            Chave do Gemini (opcional se a extensão já veio com a do time)
            <input type="password" autoComplete="off" style={inputStyle} value={gemKey} placeholder="Cole aqui para usar a sua própria chave" onChange={e => setGemKey(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
            <button style={ghostBtn} onClick={testGemini} disabled={gemTest.busy}><Icon name="bolt" size={15} /> {gemTest.busy ? 'Testando…' : 'Testar Gemini'}</button>
            {gemStatus && (
              <span style={{ fontSize: '12px', color: C.muted, fontWeight: 600 }}>
                {gemStatus.configured ? `Chave: ${gemStatus.source === 'user' ? 'a sua' : 'do time'}` : 'Sem chave'} · hoje {gemStatus.usedToday}/{gemStatus.limit} chamadas
              </span>
            )}
          </div>
          {gemTest.text && <div style={{ ...(gemTest.ok ? {} : warnStyle), marginTop: '10px', fontSize: '12.5px', fontWeight: 600 }}>{gemTest.text}</div>}
          <div style={{ ...warnStyle, marginTop: '10px' }}>
            Privacidade: a cada passo o Gemini (Google) recebe o texto da tela do CRM e, quando a aba está na frente, uma imagem, incluindo nome, telefone e anotações do lead. Use só com a ciência do time.
          </div>
        </section>
        )}

        {tab === 'envios' && (
        <section style={sectionStyle}>
          <h3 style={h3}>Diagnóstico do WhatsApp (WA-JS)</h3>
          <p style={{ ...help, margin: '0 0 10px' }}>
            A extensão usa a biblioteca WA-JS (versão fixada, com checksum) para descobrir o telefone da conversa e verificar se um número tem WhatsApp. Se ela não carregar, tudo continua funcionando pelo método antigo. O rastreamento do Google Analytics e os servidores de terceiros do WA-JS ficam <strong>desligados</strong>.
          </p>
          <button style={ghostBtn} onClick={testWpp} disabled={wpp.busy}><Icon name="bolt" size={15} /> {wpp.busy ? 'Testando…' : 'Testar agora'}</button>
          {wpp.failure && <div style={{ ...warnStyle, marginTop: '10px' }}>{wpp.failure}</div>}
          {wpp.result && !wpp.result.ok && <div style={{ ...warnStyle, marginTop: '10px' }}>{explainWppError(wpp.result.error)}</div>}
          {wpp.result && wpp.result.ok && (
            <table style={{ width: '100%', marginTop: '10px', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <tbody>
                {([
                  ['WA-JS carregado', wpp.result.data.loaded ? `sim (v${wpp.result.data.version})` : 'não'],
                  ['Pronto para uso', wpp.result.data.ready ? 'sim' : 'ainda não (espere o WhatsApp carregar)'],
                  ['Conta conectada', wpp.result.data.authenticated === null ? '—' : wpp.result.data.authenticated ? 'sim' : 'não'],
                  ['Versão do WhatsApp Web', wpp.result.data.waVersion ?? '—'],
                  ['Google Analytics desligado', wpp.result.data.analyticsDisabled === null ? '—' : wpp.result.data.analyticsDisabled ? 'sim' : 'NÃO (bloqueado por segurança)'],
                  ['Servidores de link de terceiros', wpp.result.data.linkPreviewServers === null ? '—' : wpp.result.data.linkPreviewServers === 0 ? 'nenhum (desligados)' : `${wpp.result.data.linkPreviewServers} ATIVO(S)`],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '6px 4px', color: C.muted, fontWeight: 600 }}>{k}</td>
                    <td style={{ padding: '6px 4px', fontWeight: 700 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        )}

        {tab === 'templates' && (
        <section style={sectionStyle}>
          <h3 style={h3}>Respostas rápidas e templates</h3>
          <p style={{ ...help, margin: '0 0 10px' }}>
            Variáveis automáticas: {'{nome}'}, {'{primeiro_nome}'}, {'{data}'}. Qualquer outra, como {'{empreendimento}'}, é pedida ao usar. No WhatsApp Web, digite <strong>/</strong> no campo de mensagem para inserir um template.
          </p>
          {templates.map(t => (
            <div key={t.id} style={{ border: `1px solid ${C.line}`, borderRadius: R.md, padding: '10px', marginBottom: '10px', background: C.bg }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input style={inputStyle} value={t.title} onChange={e => patchTemplate(t.id, { title: e.target.value })} placeholder="Título do template" aria-label="Título do template" />
                <button style={dangerBtn} onClick={() => setTemplates(templates.filter(x => x.id !== t.id))} aria-label="Excluir template" title="Excluir"><Icon name="trash" size={15} /></button>
              </div>
              <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={t.body} onChange={e => patchTemplate(t.id, { body: e.target.value })} placeholder="Texto com {variáveis}" aria-label="Texto do template" />
            </div>
          ))}
          <button style={ghostBtn} onClick={() => setTemplates([...templates, { id: `tpl_${Date.now()}`, title: '', body: '' }])}><Icon name="plus" size={14} /> Novo template</button>
        </section>
        )}

        <div style={{ marginTop: '16px', position: 'sticky', bottom: 0, background: C.surface, paddingTop: '8px' }}>
          <button style={{ ...primaryBtn(), width: '100%' }} onClick={saveAll}>Salvar configurações e templates</button>
        </div>

        {tab === 'dados' && (
        <section style={sectionStyle}>
          <h3 style={h3}>Backup e dados</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button style={ghostBtn} onClick={exportJson}><Icon name="download" size={15} /> Exportar backup (JSON)</button>
            <button style={ghostBtn} onClick={exportCsv}><Icon name="download" size={15} /> Exportar Kanban (CSV)</button>
            <button style={ghostBtn} onClick={() => fileRef.current?.click()}><Icon name="upload" size={15} /> Importar backup</button>
            <button style={ghostBtn} onClick={onResetColumns}><Icon name="repeat" size={15} /> Colunas padrão</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = '' }} />
          </div>
          <p style={help}>
            Os dados ficam só neste navegador/perfil e não sincronizam entre computadores. Exporte um backup de tempos em tempos, principalmente antes de reinstalar a extensão.
          </p>
        </section>
        )}
      </div>
    </div>
  )
}
