/**
 * Botão para anexar, trocar ou remover a imagem de um agendamento ou campanha.
 */

import { useEffect, useRef, useState } from 'react'
import { getImage, saveImageFile, type StoredImage } from './images'
import { C, R } from './theme'
import { ghostBtn, errorStyle } from './ui'
import { Icon } from './icons'

export function ImageThumb({ imageId, size = 64 }: { imageId: string; size?: number }) {
  const [image, setImage] = useState<StoredImage | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void getImage(imageId).then(i => { if (alive) setImage(i ?? null) })
    return () => { alive = false }
  }, [imageId])
  if (image === null) return <span style={{ fontSize: '12px', fontWeight: 700, color: C.danger }}>Imagem não encontrada: anexe de novo.</span>
  if (!image) return null
  return <img src={image.dataUrl} alt={`Imagem anexada: ${image.name}`} title={image.name} style={{ maxWidth: size * 1.8, maxHeight: size, borderRadius: R.sm, display: 'block' }} />
}

export function ImagePicker({ imageId, onChange }: { imageId?: string; onChange: (id: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File) {
    setBusy(true); setError(null)
    try {
      onChange(await saveImageFile(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {imageId && <ImageThumb imageId={imageId} />}
        <button type="button" style={ghostBtn} disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" size={15} /> {busy ? 'Preparando…' : imageId ? 'Trocar imagem' : 'Anexar imagem'}
        </button>
        {imageId && <button type="button" style={ghostBtn} onClick={() => onChange(undefined)}><Icon name="x" size={14} /> Remover imagem</button>}
        <input
          ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Escolher imagem" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }}
        />
      </div>
      {imageId && <span style={{ fontSize: '11.5px', color: C.muted, fontWeight: 500 }}>O texto da mensagem vai como legenda da imagem.</span>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </div>
  )
}
