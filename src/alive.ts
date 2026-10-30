/**
 * Depois que a extensão é recarregada ou atualizada, os scripts já injetados nas abas ficam "órfãos":
 * qualquer chamada chrome.* lança "Extension context invalidated". Estes auxiliares fazem os
 * temporizadores pararem sozinhos nesse caso, em vez de gerar erro a cada ciclo.
 */
export function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

/** setInterval que se cancela quando a extensão foi recarregada e ignora erros de contexto invalidado. */
export function safeInterval(fn: () => void | Promise<void>, ms: number): () => void {
  const timer = setInterval(() => {
    if (!extensionAlive()) {
      clearInterval(timer)
      return
    }
    try {
      const r = fn()
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* contexto invalidado */ })
    } catch {
      /* contexto invalidado */
    }
  }, ms)
  return () => clearInterval(timer)
}
