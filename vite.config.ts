import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'path'
import manifest from './manifest.json'

export default defineConfig(({ mode }) => {
  // GEMINI_API_KEY vem de .env.local (fora do git) ou do ambiente; só o service worker usa.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    define: {
      __GEMINI_API_KEY__: JSON.stringify(env.GEMINI_API_KEY ?? ''),
    },
    plugins: [
      react(),
      crx({ manifest }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup/popup.html'),
          kanban: resolve(__dirname, 'kanban/index.html'),
        },
      },
    },
  }
})
