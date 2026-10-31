/**
 * Chamada à API do Gemini (roda só no service worker: a chave nunca vai para a página do CRM).
 */

import { GEMINI_RESPONSE_SCHEMA } from './gemini'

export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiCall {
  key: string
  model: string
  system: string
  prompt: string
  imageJpegBase64?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type GeminiErrorCode = 'auth' | 'quota' | 'model' | 'network' | 'blocked' | 'http'
export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; code: GeminiErrorCode; message: string }

interface GeminiBody {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string }
}

function mapHttpError(status: number, body: GeminiBody | null): GeminiResult & { ok: false } {
  const detail = body?.error?.message ? ` (${body.error.message.slice(0, 160)})` : ''
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(body?.error?.message ?? ''))) {
    return { ok: false, code: 'auth', message: `A chave do Gemini foi recusada${detail}.` }
  }
  if (status === 404) return { ok: false, code: 'model', message: `Modelo do Gemini não encontrado${detail}. Troque o modelo em Configurações.` }
  if (status === 429) return { ok: false, code: 'quota', message: `Limite ou cota do Gemini atingido${detail}.` }
  return { ok: false, code: 'http', message: `Erro ${status} do Gemini${detail}.` }
}

export async function callGemini(c: GeminiCall): Promise<GeminiResult> {
  const doFetch = c.fetchImpl ?? fetch
  const parts: Record<string, unknown>[] = [{ text: c.prompt }]
  if (c.imageJpegBase64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: c.imageJpegBase64 } })
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: c.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_RESPONSE_SCHEMA },
  })

  let last: GeminiResult = { ok: false, code: 'network', message: 'Sem resposta do Gemini.' }
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), c.timeoutMs ?? 45_000)
    try {
      const res = await doFetch(`${ENDPOINT}/${encodeURIComponent(c.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key },
        body,
        signal: ctl.signal,
      })
      const data = (await res.json().catch(() => null)) as GeminiBody | null
      if (!res.ok) {
        last = mapHttpError(res.status, data)
        if (res.status >= 500) { await new Promise(r => setTimeout(r, 1000)); continue }
        return last
      }
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
      if (!text.trim()) {
        const why = data?.promptFeedback?.blockReason ?? data?.candidates?.[0]?.finishReason ?? 'resposta vazia'
        return { ok: false, code: 'blocked', message: `O Gemini não devolveu uma ação (${why}).` }
      }
      return { ok: true, text }
    } catch (err) {
      last = { ok: false, code: 'network', message: ctl.signal.aborted ? 'O Gemini demorou demais para responder.' : `Falha de rede ao chamar o Gemini: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      clearTimeout(timer)
    }
  }
  return last
}
