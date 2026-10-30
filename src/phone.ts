/**
 * Normaliza um telefone para dígitos E.164 (sem "+").
 * 10–11 dígitos são tratados como Brasil (DDD + número) e recebem 55.
 * 12–15 dígitos são aceitos como já tendo código de país.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  const hasPlus = raw.trim().startsWith('+')
  if (digits.startsWith('00')) digits = digits.slice(2)
  // Com "+" o código de país já foi digitado: não presume Brasil.
  else if (!hasPlus && (digits.length === 10 || digits.length === 11)) digits = '55' + digits
  if (hasPlus && digits.length >= 10 && digits.length <= 15 && !digits.startsWith('55')) return digits
  if (digits.length < 12 || digits.length > 15) return null
  if (digits.startsWith('55') && digits.length > 13) return null
  return digits
}

export function formatPhone(phone: string): string {
  if (!phone) return ''
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`
  return `+${phone}`
}

/** Extrai um telefone de um texto (ex.: título do cabeçalho de contato não salvo). */
export function phoneFromText(text: string): string | null {
  if (!/^\+?[\d\s().-]{10,}$/.test(text.trim())) return null
  return normalizePhone(text)
}
