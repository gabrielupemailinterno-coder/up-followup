// Depois do build do Vite: confere o checksum do WA-JS vendorizado e injeta no manifest os scripts
// que rodam na página do WhatsApp Web (mundo MAIN). Falha o build se algo não bater.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const die = msg => { console.error(`postbuild: ${msg}`); process.exit(1) }
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')

const version = JSON.parse(readFileSync('public/vendor/wa-js/VERSION.json', 'utf8'))
const files = {
  config: 'bridge/wm-wpp-config.js',
  waJs: 'vendor/wa-js/wppconnect-wa.js',
  bridge: 'bridge/wm-wpp-bridge.js',
}
for (const f of ['manifest.json', ...Object.values(files)]) {
  if (!existsSync(`dist/${f}`)) die(`dist/${f} não encontrado (rode o build do Vite primeiro).`)
}

const actual = sha256(`dist/${files.waJs}`)
if (actual !== version.sha256) {
  die(`checksum do WA-JS não confere.\n  esperado: ${version.sha256}\n  obtido:   ${actual}\nUse scripts/update-wajs.sh para atualizar de forma controlada.`)
}

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'))
const WA = ['https://web.whatsapp.com/*']
// idempotente: remove entradas MAIN de execuções anteriores
manifest.content_scripts = (manifest.content_scripts ?? []).filter(cs => cs.world !== 'MAIN')
manifest.content_scripts.push(
  // 1) configuração ANTES do WA-JS (desliga Google Analytics e servidores de link de terceiros)
  { matches: WA, js: [files.config], world: 'MAIN', run_at: 'document_start' },
  // 2) a biblioteca, versão fixada e com checksum conferido
  { matches: WA, js: [files.waJs], world: 'MAIN', run_at: 'document_idle' },
  // 3) a ponte com a extensão (lista curta de métodos de leitura)
  { matches: WA, js: [files.bridge], world: 'MAIN', run_at: 'document_idle' }
)
manifest.minimum_chrome_version = '111' // content scripts com world: MAIN
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(`postbuild: WA-JS ${version.tag} verificado (sha256 ${actual.slice(0, 12)}…) e injetado no manifest.`)
