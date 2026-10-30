import React, { useEffect, useRef, useState } from 'react'
import type { AppSettings, Template } from '../src/types'
import { sendToBackground } from '../src/types'
import { getSettings, getTemplates, saveSettings, saveTemplates, getTodayLog } from '../src/storage'
import { buildBackup, buildKanbanCsv, downloadFile, restoreBackup } from '../src/backup'
import { C, R } from '../src/theme'
import {
  overlayStyle, modalStyle, labelStyle, inputStyle, primaryBtn, ghostBtn, dangerBtn, warnStyle,
} from '../src/ui'
import { Icon } from '../src/icons'
import { CRM_ACTIVITY_TYPES } from '../src/crm'
import { useFeedback } from '../src/feedback'

const sectionStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R.md, padding: '14px 16px', marginTop: '14px' }
const h3: React.CSSProperties = { margin: '0 0 10px', fontSize: '13px', fontWeight: 800, color: C.brand }
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

  useEffect(() => {
    void (async () => {
      const [s, t, log] = await Promise.all([getSettings(), getTemplates(), getTodayLog()])
      setSettings(s)
      setTemplates(t)
      setUsedToday(log.count)
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
    await saveTemplates(cleaned)
    setTemplates(cleaned)
    await sendToBackground({ type: 'RESYNC_ALARMS' })
    toast('Configurações salvas.')
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
          <div style={{ ...warnStyle, marginTop: '10px' }}>
            Teste primeiro: com o modo teste ligado, envie uma mensagem para um lead de teste e veja o resultado na aba CRM. Só depois desligue o modo teste.
          </div>
        </section>

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

        <div style={{ marginTop: '16px' }}>
          <button style={{ ...primaryBtn(), width: '100%' }} onClick={saveAll}>Salvar configurações e templates</button>
        </div>

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
      </div>
    </div>
  )
}
