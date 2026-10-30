import type { CSSProperties } from 'react'

/** Ícones de traço (24x24), no mesmo peso visual do logotipo UP. */
const PATHS = {
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 7.5v8M12 7.5v11M16 7.5v5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  userPlus: '<circle cx="10" cy="8" r="4"/><path d="M2.5 21c0-4 3.4-6.5 7.5-6.5 1.4 0 2.7.3 3.8.8M19 8.5v6M16 11.5h6"/>',
  send: '<path d="M21.5 2.5L10.5 13.5M21.5 2.5l-6.8 19-4.2-8-8-4.2 19-6.8z"/>',
  megaphone: '<path d="M3 10.5v3a1 1 0 0 0 1 1h2.5l5.5 4v-13l-5.5 4H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  chart: '<path d="M6 20v-7M12 20V5M18 20v-10M3 20.5h18"/>',
  sliders: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-.5"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13l0-7.5z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2V5z"/><path d="M4 20a2 2 0 0 0 2 2h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  play: '<path d="M7 4.5l12 7.5-12 7.5v-15z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M4 4h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
  chat: '<path d="M4 5.5h16v11H9.5L4 20.5v-15z"/>',
  tag: '<path d="M3 12V4h8l9.5 9.5-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  note: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bot: '<rect x="4" y="8" width="16" height="11.5" rx="3.5"/><path d="M12 8V4.5M9 13.5h.01M15 13.5h.01M9.5 17h5"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L3 13.5a1.6 1.6 0 0 1 2.6-1.8L8 14"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  alert: '<path d="M12 3.5l9.5 17h-19L12 3.5zM12 10v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  repeat: '<path d="M17 3l3 3-3 3M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="3.5"/><path d="M15 4v16"/>',
  zap: '<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13l0-7.5z"/>',
  pencil: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l3 3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name, size = 18, strokeWidth = 1.8, style, title,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  style?: CSSProperties
  title?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + PATHS[name] }}
    />
  )
}
