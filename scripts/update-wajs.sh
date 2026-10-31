#!/usr/bin/env bash
# Atualiza o WA-JS vendorizado de forma controlada e auditável.
#
#   scripts/update-wajs.sh v4.8.0
#
# Baixa a release, CONFERE o digest publicado pelo GitHub, lista os endereços de rede embutidos
# (para você revisar se apareceu algum novo) e grava o novo checksum em public/vendor/wa-js/VERSION.json.
# Não faz commit: revise o diff, rode npm run build e teste antes de publicar.

set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:?uso: scripts/update-wajs.sh vX.Y.Z}"
REPO="wppconnect-team/wa-js"
ASSET="wppconnect-wa.js"
DEST="public/vendor/wa-js"

command -v gh >/dev/null || { echo "Instale o GitHub CLI (gh)." >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "==> Baixando $TAG"
gh release download "$TAG" --repo "$REPO" --pattern "$ASSET" --dir "$TMP"
SHA="$(shasum -a 256 "$TMP/$ASSET" | cut -d' ' -f1)"
PUBLISHED="$(gh release view "$TAG" --repo "$REPO" --json assets --jq ".assets[] | select(.name==\"$ASSET\") | .digest" | sed 's/^sha256://')"
if [ "$SHA" != "$PUBLISHED" ]; then
  echo "ERRO: o checksum baixado ($SHA) não bate com o publicado pelo GitHub ($PUBLISHED)." >&2
  exit 1
fi
echo "    checksum confere com o publicado pelo GitHub"

echo "==> Endereços de rede embutidos (REVISE: só devem aparecer whatsapp.com, wa.me e os já neutralizados):"
grep -aoE 'https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+' "$TMP/$ASSET" | sed -E 's#(https?://[^/]+).*#\1#' | sort | uniq -c | sort -rn
echo
echo "    Já neutralizados em public/bridge/wm-wpp-config.js:"
echo "      analytics.google.com, cobrancas.uppermesh.com.br, wajsapi.titanchat.com.br, wppc-linkpreview.cloudtrix.com.br"
echo "    Qualquer host NOVO acima precisa ser entendido e, se sair da página, neutralizado ANTES de publicar."

cp "$TMP/$ASSET" "$DEST/$ASSET"
gh api "repos/$REPO/contents/LICENSE?ref=$TAG" --jq .content | base64 -d > "$DEST/LICENSE"
python3 - "$TAG" "$SHA" <<'PY'
import json, sys, datetime
p = 'public/vendor/wa-js/VERSION.json'
v = json.load(open(p))
v['tag'], v['sha256'] = sys.argv[1], sys.argv[2]
v['source'] = f"https://github.com/wppconnect-team/wa-js/releases/tag/{sys.argv[1]}"
v['retrievedAt'] = datetime.date.today().isoformat()
json.dump(v, open(p, 'w'), indent=2, ensure_ascii=False); open(p, 'a').write('\n')
PY
echo "==> Atualizado para $TAG. Próximo: revisar 'git diff', npm run build, testar no WhatsApp (Configurações > Diagnóstico) e só então publicar."
