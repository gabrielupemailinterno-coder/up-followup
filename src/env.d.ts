/** Chave do Gemini embutida no build (vem de .env.local, que não vai para o git). Só o service worker usa. */
declare const __GEMINI_API_KEY__: string
/** Chave do Claude (Anthropic) embutida no build, de ANTHROPIC_API_KEY no .env.local. Só o service worker usa. */
declare const __ANTHROPIC_API_KEY__: string
