param(
  [string]$RepositoryUrl = 'https://github.com/PT-Original-Point/ptysd-vnext42-governance-sandbox',
  [string]$RunnerName = 'PTYSD-V45-CONTROL-01',
  [string]$RunnerRoot = 'C:\actions-runner-v45'
)

$ErrorActionPreference = 'Stop'
$Version = '2.337.0'
$ArchiveName = "actions-runner-win-x64-$Version.zip"
$ArchiveUrl = "https://github.com/actions/runner/releases/download/v$Version/$ArchiveName"
$ExpectedSha256 = '1150692afa94e71f872017e254ea55b6eece1eece3fe7e3a6d4c93d0a1b85cfc'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'ADMIN_SHELL_REQUIRED'
}

New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
$archive = Join-Path $RunnerRoot $ArchiveName
if (-not (Test-Path $archive)) {
  Invoke-WebRequest -Uri $ArchiveUrl -OutFile $archive -UseBasicParsing
}

$actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256) {
  throw "RUNNER_ARCHIVE_SHA256_MISMATCH expected=$ExpectedSha256 actual=$actual"
}

$config = Join-Path $RunnerRoot 'config.cmd'
if (-not (Test-Path $config)) {
  Expand-Archive -LiteralPath $archive -DestinationPath $RunnerRoot -Force
}
if (-not (Test-Path $config)) {
  throw 'RUNNER_CONFIG_NOT_FOUND_AFTER_EXTRACT'
}
if (Test-Path (Join-Path $RunnerRoot '.runner')) {
  throw 'RUNNER_ALREADY_CONFIGURED_MANUAL_RECONCILIATION_REQUIRED'
}

$token = $env:PTYSD_GH_RUNNER_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host 'HUMAN_GATE=GITHUB_SELF_HOSTED_RUNNER_REGISTRATION_TOKEN_REQUIRED'
  Write-Host 'Set PTYSD_GH_RUNNER_TOKEN only in this elevated process, then rerun this script.'
  exit 42
}

Push-Location $RunnerRoot
try {
  & .\config.cmd --unattended --url $RepositoryUrl --token $token --name $RunnerName --labels ptysd-governance-v45 --work _work --runasservice
  if ($LASTEXITCODE -ne 0) { throw "RUNNER_CONFIG_FAILED exit=$LASTEXITCODE" }
} finally {
  $env:PTYSD_GH_RUNNER_TOKEN = $null
  Pop-Location
}

$service = Get-Service | Where-Object { $_.Name -like 'actions.runner.*' } | Select-Object -First 1
if (-not $service) { throw 'RUNNER_SERVICE_NOT_FOUND_AFTER_CONFIG' }
if ($service.Status -ne 'Running') { Start-Service -Name $service.Name }
$service = Get-Service -Name $service.Name
[pscustomobject]@{
  Result = 'RUNNER_REGISTERED'
  RunnerName = $RunnerName
  RepositoryUrl = $RepositoryUrl
  ServiceName = $service.Name
  ServiceStatus = $service.Status.ToString()
  Version = $Version
  ArchiveSha256 = $actual
} | ConvertTo-Json -Depth 3
