/**
 * Escuta o chrome.storage.local só para as chaves pedidas e agrupa rajadas (debounce).
 * O chrome.storage.onChanged dispara em todos os contextos da extensão para QUALQUER chave; sem filtro,
 * cada escrita (ex.: o índice de leads do CRM) faria todas as abas do WhatsApp recarregarem tudo.
 */
export function watchStorage(keys: string[], cb: () => void, debounceMs = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area !== 'local' || !keys.some(k => k in changes)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(cb, debounceMs)
  }
  chrome.storage.onChanged.addListener(listener)
  return () => {
    chrome.storage.onChanged.removeListener(listener)
    if (timer) clearTimeout(timer)
  }
}
