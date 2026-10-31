#!/usr/bin/env bash
# Instalador do Follow-up UP (macOS e Linux).
#
#   gh api repos/gabrielupemailinterno-coder/up-followup/contents/install.sh -H "Accept: application/vnd.github.raw" | bash
#   (repositório privado: exige o GitHub CLI logado com `gh auth login`)
#
# Baixa a versão mais recente (GitHub Releases) e extrai em ~/UP-Followup.
# Rode o mesmo comando de novo para atualizar. Não precisa de Node nem de Git.
#
# Opções (use "bash -s -- OPÇÃO" quando rodar via curl):
#   --no-open   não abre o Chrome nem o manual
# Variáveis opcionais: UP_FOLLOWUP_DIR=/outro/caminho   UP_FOLLOWUP_TAG=vX.Y.Z (instala uma versão específica,
# inclusive pré-lançamentos; sem ela, instala a mais recente estável)

set -euo pipefail

REPO="gabrielupemailinterno-coder/up-followup"
ASSET="up-followup.zip"
DEST="${UP_FOLLOWUP_DIR:-$HOME/UP-Followup}"
OPEN=1

for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,12p' "$0" 2>/dev/null || true; exit 0 ;;
  esac
done

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

command -v gh    >/dev/null 2>&1 || die "GitHub CLI (gh) não encontrado. Instale em https://cli.github.com e rode 'gh auth login' com a conta que tem acesso ao repositório."
gh auth status   >/dev/null 2>&1 || die "Você não está logado no GitHub CLI. Rode 'gh auth login' e tente de novo."
command -v unzip >/dev/null 2>&1 || die "unzip não encontrado. Instale o unzip e tente de novo."

# Segurança: nunca limpar uma pasta que não seja uma instalação anterior.
case "$DEST" in
  ""|"/"|"$HOME"|"$HOME/") die "Pasta de destino inválida: '$DEST'." ;;
esac
if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && [ ! -f "$DEST/manifest.json" ]; then
  die "'$DEST' já existe e não parece uma instalação do Follow-up UP. Escolha outra pasta com UP_FOLLOWUP_DIR=..."
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" | head -1; }

# Repositório privado: o download usa o GitHub CLI autenticado (gh release download).
TAG_ARGS=()
if [ -n "${UP_FOLLOWUP_TAG:-}" ]; then
  TAG_ARGS=("$UP_FOLLOWUP_TAG")
  say "Versão pedida: $UP_FOLLOWUP_TAG"
fi
say "Baixando a versão mais recente…"
gh release download ${TAG_ARGS[@]+"${TAG_ARGS[@]}"} --repo "$REPO" --pattern "$ASSET" --dir "$TMP" --clobber || die "Não consegui baixar a release. Verifique a internet, o 'gh auth login' e se a sua conta tem acesso ao repositório."

mkdir "$TMP/x"
unzip -q "$TMP/$ASSET" -d "$TMP/x" || die "Falha ao extrair o ZIP."
[ -f "$TMP/x/manifest.json" ] || die "ZIP inválido: manifest.json não encontrado."

NEW_VERSION="$(version_of "$TMP/x/manifest.json")"
OLD_VERSION=""
[ -f "$DEST/manifest.json" ] && OLD_VERSION="$(version_of "$DEST/manifest.json")"

mkdir -p "$DEST"
# Troca o conteúdo mantendo a pasta: o Chrome continua apontando para o mesmo caminho.
find "$DEST" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "$TMP/x/." "$DEST/"

if [ -n "$OLD_VERSION" ]; then
  say "Atualizado: v$OLD_VERSION -> v$NEW_VERSION"
else
  say "Instalado: v$NEW_VERSION"
fi
say "Pasta da extensão: $DEST"

# Copia o caminho para a área de transferência (facilita o passo "Carregar sem compactação").
if command -v pbcopy >/dev/null 2>&1; then printf '%s' "$DEST" | pbcopy && say "Caminho copiado para a área de transferência."
elif command -v xclip >/dev/null 2>&1; then printf '%s' "$DEST" | xclip -selection clipboard && say "Caminho copiado para a área de transferência."
fi

if [ -n "$OLD_VERSION" ]; then
  cat <<EOF

Falta só recarregar:
  1. Abra chrome://extensions
  2. Na extensão "WhatsApp Web Mod", clique no botão de recarregar (seta circular)
  3. Atualize o WhatsApp Web com F5
Seus dados são mantidos.
EOF
else
  cat <<EOF

Faltam 4 passos no navegador:
  1. Abra chrome://extensions (Edge: edge://extensions)
  2. Ligue o "Modo do desenvolvedor" (canto superior direito)
  3. Clique em "Carregar sem compactação" e escolha a pasta:
       $DEST
  4. Abra web.whatsapp.com e conecte a sua conta

O manual completo abre sozinho dentro da extensão na primeira vez.
EOF
fi

if [ "$OPEN" = "1" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    open -a "Google Chrome" "chrome://extensions" >/dev/null 2>&1 || warn "Abra chrome://extensions manualmente."
    [ -z "$OLD_VERSION" ] && open "$DEST/manual/index.html" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    [ -z "$OLD_VERSION" ] && xdg-open "$DEST/manual/index.html" >/dev/null 2>&1 || true
  fi
fi
