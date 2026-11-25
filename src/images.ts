/**
 * Imagens anexadas a agendamentos e campanhas. Cada uma fica em uma chave própria
 * (wm_img_<id>) para não pesar nas listas.
 */

import { getCampaigns, getScheduledMessages } from './storage'

export interface StoredImage {
  dataUrl: string
  name: string
  createdAt: number
}

const PREFIX = 'wm_img_'
const MAX_SIDE = 1600
const MAX_FILE_BYTES = 20 * 1024 * 1024

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const key = PREFIX + id
  return (await chrome.storage.local.get(key))[key] as StoredImage | undefined
}

export async function putImage(id: string, image: StoredImage): Promise<void> {
  await chrome.storage.local.set({ [PREFIX + id]: image })
}

/** Reduz a foto para um tamanho bom para o WhatsApp (JPEG, até 1600 px) e guarda. Devolve o id. */
export async function saveImageFile(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma imagem JPG, PNG ou WEBP.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Imagem muito grande (máximo de 20 MB).')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não consegui preparar a imagem.')
  ctx.fillStyle = '#fff'   // fundo branco para PNG transparente
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const now = Date.now()
  const id = `${now}_${Math.random().toString(36).slice(2, 8)}`
  await putImage(id, { dataUrl: canvas.toDataURL('image/jpeg', 0.85), name: file.name, createdAt: now })
  return id
}

/** Ids em uso por agendamentos e campanhas. */
export async function usedImageIds(): Promise<string[]> {
  const [schedules, campaigns] = await Promise.all([getScheduledMessages(), getCampaigns()])
  return [...new Set([...schedules, ...campaigns].map(x => x.imageId).filter((v): v is string => Boolean(v)))]
}

/** Apaga imagens que ninguém usa. Poupa as recentes: podem estar em um formulário ainda aberto. */
export async function pruneImages(now = Date.now()): Promise<number> {
  const all = await chrome.storage.local.get(null)
  const used = new Set((await usedImageIds()).map(id => PREFIX + id))
  const stale = Object.keys(all).filter(k =>
    k.startsWith(PREFIX) && !used.has(k) && now - ((all[k] as StoredImage).createdAt ?? 0) > 24 * 3600_000)
  if (stale.length) await chrome.storage.local.remove(stale)
  return stale.length
}
