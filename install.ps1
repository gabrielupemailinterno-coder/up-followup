# Instalador do Follow-up UP (Windows / PowerShell).
#
#   irm https://raw.githubusercontent.com/gabrielupemailinterno-coder/up-followup/main/install.ps1 | iex
#
# Baixa a versão mais recente (GitHub Releases) e extrai em %USERPROFILE%\UP-Followup.
# Rode o mesmo comando de novo para atualizar. Não precisa de Node nem de Git.
#
# Variáveis opcionais (defina antes de rodar):
#   $env:UP_NO_OPEN = "1"          não abre o navegador nem o manual
#   $env:UP_FOLLOWUP_DIR = "C:\x"  outra pasta de destino

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # acelera o download no Windows PowerShell 5

$Repo  = 'gabrielupemailinterno-coder/up-followup'
$Asset = 'up-followup.zip'
$Dest  = if ($env:UP_FOLLOWUP_DIR) { $env:UP_FOLLOWUP_DIR } else { Join-Path $env:USERPROFILE 'UP-Followup' }
$Open  = -not $env:UP_NO_OPEN

function Say($m)  { Write-Host "==> $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "Erro: $m" -ForegroundColor Red; throw $m }

# TLS 1.2 para o PowerShell 5
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Get-Version($manifest) { (Get-Content $manifest -Raw | ConvertFrom-Json).version }

# Segurança: nunca limpar uma pasta que não seja uma instalação anterior.
$full = [IO.Path]::GetFullPath($Dest).TrimEnd('\')
if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\') -or $full -eq $env:USERPROFILE.TrimEnd('\')) {
    Die "Pasta de destino inválida: '$Dest'."
}
if ((Test-Path $Dest) -and (Get-ChildItem $Dest -Force | Select-Object -First 1) -and -not (Test-Path (Join-Path $Dest 'manifest.json'))) {
    Die "'$Dest' já existe e não parece uma instalação do Follow-up UP. Defina `$env:UP_FOLLOWUP_DIR com outra pasta."
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("up-followup-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
    $Url = "https://github.com/$Repo/releases/latest/download/$Asset"
    $Zip = Join-Path $Tmp $Asset
    Say 'Baixando a versão mais recente…'
    try { Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing }
    catch { Die "Não consegui baixar $Url. Verifique a internet e se já existe uma release publicada." }

    $Extract = Join-Path $Tmp 'x'
    Expand-Archive -Path $Zip -DestinationPath $Extract -Force
    $manifest = Join-Path $Extract 'manifest.json'
    if (-not (Test-Path $manifest)) { Die 'ZIP inválido: manifest.json não encontrado.' }

    $NewVersion = Get-Version $manifest
    $OldVersion = $null
    $oldManifest = Join-Path $Dest 'manifest.json'
    if (Test-Path $oldManifest) { $OldVersion = Get-Version $oldManifest }

    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    # Troca o conteúdo mantendo a pasta: o navegador continua apontando para o mesmo caminho.
    Get-ChildItem $Dest -Force | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $Extract '*') -Destination $Dest -Recurse -Force

    if ($OldVersion) { Say "Atualizado: v$OldVersion -> v$NewVersion" } else { Say "Instalado: v$NewVersion" }
    Say "Pasta da extensão: $Dest"

    try { Set-Clipboard -Value $Dest; Say 'Caminho copiado para a área de transferência.' } catch {}

    if ($OldVersion) {
        Write-Host @"

Falta só recarregar:
  1. Abra chrome://extensions
  2. Na extensão "WhatsApp Web Mod", clique no botão de recarregar (seta circular)
  3. Atualize o WhatsApp Web com F5
Seus dados são mantidos.
"@
    } else {
        Write-Host @"

Faltam 4 passos no navegador:
  1. Abra chrome://extensions (Edge: edge://extensions)
  2. Ligue o "Modo do desenvolvedor" (canto superior direito)
  3. Clique em "Carregar sem compactação" e escolha a pasta:
       $Dest
  4. Abra web.whatsapp.com e conecte a sua conta

O manual completo abre sozinho dentro da extensão na primeira vez.
"@
    }

    if ($Open) {
        $chrome = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'
        $edge   = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'
        try {
            if ($chrome)   { Start-Process $chrome 'chrome://extensions' }
            elseif ($edge) { Start-Process $edge 'edge://extensions' }
            else { Warn 'Abra chrome://extensions manualmente.' }
        } catch { Warn 'Abra chrome://extensions manualmente.' }
        if (-not $OldVersion) { try { Start-Process (Join-Path $Dest 'manual\index.html') } catch {} }
    }
}
finally {
    Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
