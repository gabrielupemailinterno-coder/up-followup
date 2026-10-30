#!/usr/bin/env bash
# Publica uma nova versão (para quem mantém o projeto).
#
#   1. Atualize "version" em package.json e manifest.json (e a versão no manual)
#   2. git commit && git push
#   3. npm run release
#
# Gera up-followup.zip + manual em PDF e cria a release "vX.Y.Z" no GitHub.
# O instalador do time (install.sh / install.ps1) sempre baixa a release mais recente.

set -euo pipefail
cd "$(dirname "$0")/.."

command -v gh  >/dev/null || { echo "Instale o GitHub CLI (gh) e rode 'gh auth login'." >&2; exit 1; }
command -v zip >/dev/null || { echo "Instale o zip." >&2; exit 1; }

VERSION="$(node -p "require('./package.json').version")"
MANIFEST_VERSION="$(node -p "require('./manifest.json').version")"
[ "$VERSION" = "$MANIFEST_VERSION" ] || { echo "Versões diferentes: package.json=$VERSION manifest.json=$MANIFEST_VERSION" >&2; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "Há alterações não commitadas. Faça commit e push antes de publicar." >&2
  exit 1
fi

echo "==> Compilando v$VERSION"
npm run build

mkdir -p releases
ZIP="releases/up-followup.zip"
PDF="releases/Manual-Follow-up-UP-v$VERSION.pdf"
rm -f "$ZIP"
# zip clássico: entradas sem "./", compatível com o Expand-Archive do Windows
(cd dist && zip -qr "../$ZIP" . -x '.DS_Store')

echo "==> Gerando o manual em PDF"
CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
  if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
done
ASSETS=("$ZIP")
if [ -n "$CHROME" ]; then
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
    --user-data-dir="$(mktemp -d)" --print-to-pdf="$PWD/$PDF" "file://$PWD/dist/manual/index.html" >/dev/null 2>&1 || true
  [ -f "$PDF" ] && ASSETS+=("$PDF")
else
  echo "   (Chrome não encontrado: release sem PDF do manual)"
fi

echo "==> Criando a release v$VERSION no GitHub"
gh release create "v$VERSION" "${ASSETS[@]}" \
  --title "Follow-up UP v$VERSION" \
  --notes "Versão $VERSION. Para instalar ou atualizar, veja o README (comando de uma linha)." \
  --latest

echo "==> Pronto. Time: rode o comando do instalador de novo para atualizar."
