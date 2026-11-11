# Atualizador do Follow-up UP
# Cole no PowerShell para atualizar:
#   irm https://raw.githubusercontent.com/gabrielupemailinterno-coder/up-followup/main/update-up.ps1 | iex
# Ou clique com botão direito neste arquivo → Executar com o PowerShell

$ErrorActionPreference = "Stop"
$REPO     = "gabrielupemailinterno-coder/up-followup"
$API_URL  = "https://api.github.com/repos/$REPO/releases/latest"
$DEST     = "$env:USERPROFILE\UP-Followup"
$ZIP_TMP  = "$env:TEMP\up-followup-update.zip"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "ERRO: $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  Follow-up UP — Atualizador" -ForegroundColor Cyan
Write-Host "  github.com/$REPO" -ForegroundColor DarkGray
Write-Host ""

# --- Versão atual instalada ---
$currentVersion = ""
$manifestPath   = "$DEST\manifest.json"
if (Test-Path $manifestPath) {
    try {
        $manifest       = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $currentVersion = $manifest.version
        Write-Step "Versao atual instalada: v$currentVersion"
    } catch {
        Write-Warn "Nao consegui ler a versao atual."
    }
} else {
    Write-Warn "Pasta $DEST nao encontrada — fazendo instalacao inicial."
}

# --- Buscar versão mais recente ---
Write-Step "Verificando versao mais recente..."
try {
    $release     = Invoke-RestMethod -Uri $API_URL -UseBasicParsing
    $latestTag   = $release.tag_name
    $latestVer   = $latestTag.TrimStart("v")
    $asset       = $release.assets | Where-Object { $_.name -eq "up-followup.zip" } | Select-Object -First 1
    $downloadUrl = $asset.browser_download_url
} catch {
    Write-Err "Nao consegui acessar o GitHub. Verifique sua conexao."
    Read-Host "Pressione Enter para fechar"
    exit 1
}

if (-not $downloadUrl) {
    Write-Err "Arquivo up-followup.zip nao encontrado na release $latestTag."
    Read-Host "Pressione Enter para fechar"
    exit 1
}

if ($currentVersion -eq $latestVer) {
    Write-Host ""
    Write-Host "  Voce ja esta na versao mais recente (v$latestVer)." -ForegroundColor Green
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 0
}

Write-Step "Nova versao disponivel: v$latestVer"

# --- Baixar ---
Write-Step "Baixando..."
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $ZIP_TMP -UseBasicParsing
} catch {
    Write-Err "Falha no download: $_"
    Read-Host "Pressione Enter para fechar"
    exit 1
}

# --- Extrair ---
Write-Step "Instalando em $DEST..."
if (-not (Test-Path $DEST)) { New-Item -ItemType Directory -Path $DEST | Out-Null }

try {
    Expand-Archive -Path $ZIP_TMP -DestinationPath $DEST -Force
} catch {
    Write-Err "Falha ao extrair o zip: $_"
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Remove-Item $ZIP_TMP -ErrorAction SilentlyContinue

# --- Concluído ---
Write-Host ""
Write-Host "  Atualizado: v$currentVersion -> v$latestVer" -ForegroundColor Green
Write-Host ""
Write-Host "  Falta so recarregar:" -ForegroundColor White
Write-Host "  1. Abra chrome://extensions no Chrome" -ForegroundColor White
Write-Host "  2. Encontre 'Follow-up UP' e clique na seta de recarregar (↺)" -ForegroundColor White
Write-Host "  3. Recarregue o WhatsApp Web com F5" -ForegroundColor White
Write-Host "  Seus dados sao mantidos." -ForegroundColor DarkGray
Write-Host ""

try { Start-Process "chrome" "chrome://extensions" } catch {
    try { Start-Process "msedge" "edge://extensions" } catch {}
}

Read-Host "Pressione Enter para fechar"
