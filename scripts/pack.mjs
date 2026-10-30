// Gera whatsapp-web-mod-vX.Y.Z.zip a partir de dist/ (rode depois do build).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'

if (!existsSync('dist/manifest.json')) {
  console.error('dist/ não encontrado. Rode "npm run build" primeiro.')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
mkdirSync('releases', { recursive: true })
const out = `releases/whatsapp-web-mod-v${version}.zip`
rmSync(out, { force: true })

try {
  // zip clássico: entradas sem "./", compatível com o Expand-Archive do Windows
  execFileSync('zip', ['-qr', `../${out}`, '.', '-x', '.DS_Store'], { cwd: 'dist', stdio: 'inherit' })
} catch {
  // reserva: bsdtar (macOS e Windows 10+)
  execFileSync('tar', ['--format', 'zip', '-cf', out, '-C', 'dist', '.'], { stdio: 'inherit' })
}
console.log(`Gerado: ${out}`)
