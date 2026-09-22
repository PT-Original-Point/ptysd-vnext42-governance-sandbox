Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='C:\ProgramData\PTYSD\MCP'
$runtime=Join-Path $root 'tunnel\v0.0.14\tunnel-client.exe'
$key=Join-Path $root 'secrets\control-plane-api-key.txt'
if(!(Test-Path -LiteralPath $runtime -PathType Leaf)){throw 'TUNNEL_RUNTIME_MISSING'}
function H([string[]]$a){try{return ((@(& $runtime @a 2>&1)|ForEach-Object{[string]$_})-join [Environment]::NewLine)}catch{return [string]$_.Exception.Message}}
$rootHelp=H @('--help')
$adminHelp=H @('admin','tunnels','create','--help')
$doctorHelp=H @('doctor','--help')
$runHelp=H @('run','--help')
function F([string]$s,[string]$p){return [bool]($s -match $p)}
[ordered]@{
 schema='v49.p5.tunnel-cli-capability-help.v1';readback_only=$true
 runtime_sha256=(Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
 existing_control_plane_key_file_present=[bool](Test-Path -LiteralPath $key -PathType Leaf)
 admin_create=[ordered]@{profile_file=F $adminHelp '(?i)--profile-file';api_key=F $adminHelp '(?i)--api-key';api_key_file=F $adminHelp '(?i)--api-key-file';name=F $adminHelp '(?i)--name';json=F $adminHelp '(?i)--json';tunnel_id=F $adminHelp '(?i)--tunnel-id';account=F $adminHelp '(?i)--account'}
 doctor=[ordered]@{profile_file=F $doctorHelp '(?i)--profile-file';explain=F $doctorHelp '(?i)--explain';server_url=F $doctorHelp '(?i)server-url';client_cert=F $doctorHelp '(?i)client-cert';client_key=F $doctorHelp '(?i)client-key';ca_bundle=F $doctorHelp '(?i)ca-bundle'}
 run=[ordered]@{profile_file=F $runHelp '(?i)--profile-file';server_url=F $runHelp '(?i)server-url';client_cert=F $runHelp '(?i)client-cert';client_key=F $runHelp '(?i)client-key';ca_bundle=F $runHelp '(?i)ca-bundle'}
 root_mentions_server_url=F $rootHelp '(?i)server-url';root_mentions_client_cert=F $rootHelp '(?i)client-cert';root_mentions_client_key=F $rootHelp '(?i)client-key'
 no_help_text_output=$true;no_secret_value_output=$true;no_file_mutation=$true;no_tunnel_create=$true;no_task_mutation=$true
 observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 6 -Compress
