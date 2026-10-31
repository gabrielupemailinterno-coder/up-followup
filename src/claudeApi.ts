/**
 * Chamada ao Claude (Anthropic) pelo SDK oficial. Roda só no service worker: a chave nunca vai
 * para as páginas do CRM ou do WhatsApp. Devolve o JSON como texto, no mesmo formato da chamada
 * ao Gemini, para o resto da extensão (validação das ações, leitura das sugestões) não mudar.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

export const CLAUDE_DEFAULT_MODEL = 'claude-haiku-5-5'

/** Uma ação do piloto do CRM por resposta (validada de novo por validateAction). */
const ActionSchema = z.object({
  action: z.enum(['click', 'click_at', 'type', 'wait', 'done', 'fail']),
  target: z.number().int().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  reason: z.string(),
})

/** Três mensagens sugeridas para o lead (painel UP no CRM). */
const SuggestSchema = z.object({
  messages: z.array(z.string()),
})

export type ClaudeSchema = 'action' | 'suggest'

export interface ClaudeCall {
  key: string
  model: string
  system: string
  prompt: string
  schema: ClaudeSchema
  imageJpegBase64?: string
  timeoutMs?: number
}

export type ClaudeResult =
  | { ok: true; text: string }
  | { ok: false; code: 'auth' | 'quota' | 'model' | 'network' | 'blocked' | 'http'; message: string }

export async function callClaude(c: ClaudeCall): Promise<ClaudeResult> {
  // Extensão interna do time: a chave embutida é uma decisão consciente (ver README > Piloto IA).
  const client = new Anthropic({ apiKey: c.key, dangerouslyAllowBrowser: true, timeout: c.timeoutMs ?? 45_000, maxRetries: 2 })
  const content: Anthropic.ContentBlockParam[] = []
  if (c.imageJpegBase64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.imageJpegBase64 } })
  content.push({ type: 'text', text: c.prompt })
  try {
    const response = await client.messages.parse({
      model: c.model,
      max_tokens: 4000,
      system: c.system,
      messages: [{ role: 'user', content }],
      // piloto: rápido; sugestões: um pouco mais de cuidado com o texto
      output_config: { effort: c.schema === 'action' ? 'low' : 'medium', format: zodOutputFormat(c.schema === 'action' ? ActionSchema : SuggestSchema) },
    })
    if (response.stop_reason === 'refusal') return { ok: false, code: 'blocked', message: `O Claude recusou o pedido${response.stop_details?.explanation ? ` (${response.stop_details.explanation})` : ''}.` }
    if (response.stop_reason === 'max_tokens') return { ok: false, code: 'blocked', message: 'A resposta do Claude ficou grande demais.' }
    if (!response.parsed_output) return { ok: false, code: 'blocked', message: 'O Claude não devolveu o formato pedido.' }
    return { ok: true, text: JSON.stringify(response.parsed_output) }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, code: 'auth', message: 'A chave do Claude foi recusada. Confira em Configurações > IA.' }
    if (err instanceof Anthropic.NotFoundError) return { ok: false, code: 'model', message: `Modelo do Claude não encontrado (${c.model}). Troque o modelo em Configurações > IA.` }
    if (err instanceof Anthropic.RateLimitError) return { ok: false, code: 'quota', message: 'Limite de uso do Claude atingido. Tente de novo em instantes.' }
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, code: 'network', message: 'Sem conexão com o Claude (rede ou tempo esgotado).' }
    if (err instanceof Anthropic.APIError) return { ok: false, code: 'http', message: `Erro ${err.status ?? ''} do Claude: ${err.message.slice(0, 160)}` }
    return { ok: false, code: 'http', message: `Falha ao chamar o Claude: ${err instanceof Error ? err.message : String(err)}` }
  }
}
