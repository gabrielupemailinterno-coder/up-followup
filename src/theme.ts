/**
 * Identidade visual UP (Rebranding 2026).
 * Paleta, tipografia e tokens usados por popup, Kanban, manual e painéis no WhatsApp Web.
 */

export const UP = {
  verde: '#3A4A3F',        // Verde Escuro
  verdeClaro: '#7B896F',   // Verde Claro
  cinza: '#2F302A',        // Cinza
  preto: '#0D0F0C',        // Preto
  offWhite: '#F7F4ED',     // Off White
} as const

export const C = {
  bg: UP.offWhite,
  surface: '#FFFFFF',
  ink: UP.preto,
  inkSoft: UP.cinza,
  muted: '#5E6558',        // texto secundário (contraste AA sobre off white)
  line: '#E4E0D4',
  lineStrong: '#CFCABB',

  brand: UP.verde,
  brandHover: '#2F3C33',
  onBrand: UP.offWhite,
  accent: UP.verdeClaro,
  accentSoft: '#E9EDE2',
  accentLine: '#C9D1BE',

  // Estados funcionais, em tons terrosos que convivem com a paleta
  ok: '#3F6B4B',
  okSoft: '#E4EFE6',
  warn: '#8A5E14',
  warnSoft: '#F6ECD6',
  danger: '#A5432F',
  dangerSoft: '#F7E4DF',
  info: '#34566B',
  infoSoft: '#E1ECF2',
} as const

export const FONT = "'Manrope', 'Segoe UI', system-ui, -apple-system, sans-serif"

export const R = { sm: '8px', md: '12px', lg: '16px', pill: '999px' } as const

export const SHADOW = {
  card: '0 1px 2px rgba(13,15,12,0.06), 0 4px 14px rgba(13,15,12,0.06)',
  pop: '0 16px 48px rgba(13,15,12,0.30)',
  dock: '0 6px 24px rgba(13,15,12,0.35)',
} as const

/** Estilos base compartilhados (foco visível, rolagem, movimento reduzido). */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
button,input,select,textarea{font-family:inherit}
button{cursor:pointer}
button:disabled{cursor:not-allowed}
:focus-visible{outline:2px solid ${UP.verdeClaro};outline-offset:2px}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:${C.lineStrong};border-radius:10px;border:2px solid transparent;background-clip:content-box}
::-webkit-scrollbar-track{background:transparent}
input::placeholder,textarea::placeholder{color:#8A9082}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
`

/** @font-face da Manrope (variável) a partir de uma função que resolve a URL do arquivo. */
export function fontFaceCss(url: (file: string) => string): string {
  return `
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;
src:url('${url('fonts/manrope-latin-ext.woff2')}') format('woff2');
unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Manrope';font-style:normal;font-weight:200 800;font-display:swap;
src:url('${url('fonts/manrope-latin.woff2')}') format('woff2');
unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
`
}

export const brandUrl = (file: string) => chrome.runtime.getURL(`brand/${file}`)
