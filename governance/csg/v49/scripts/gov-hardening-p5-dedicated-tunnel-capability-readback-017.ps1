Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$requestId='b7579fda317447aaa6e1b06646437c46'
$receiptPath=Join-Path 'C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts' ($requestId+'.json')
$rr=$null
if(Test-Path -LiteralPath $receiptPath -PathType Leaf){try{$rr=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{}}
function P($o,[string]$n){if($null-eq$o){return $null};if($o.PSObject.Properties.Name -contains $n){return $o.$n};return $null}
$root='C:\ProgramData\PTYSD\MCP'
$profile=Join-Path $root 'config\factory-mcp-tunnel.yaml'
$runtime=Join-Path $root 'tunnel\v0.0.14\tunnel-client.exe'
$taskName='PTYSD-FactoryMCP-Tunnel-V47'
$raw=if(Test-Path -LiteralPath $profile -PathType Leaf){Get-Content -LiteralPath $profile -Raw}else{''}
$id=$null;$m=[regex]::Match($raw,'(?m)^\s*tunnel_id:\s*(tunnel_[0-9a-f]{32})\s*$');if($m.Success){$id=$m.Groups[1].Value}
$mode=if($raw -match '(?m)^\s*server_urls:\s*$'){'HTTP_SERVER_URL'}elseif($raw -match '(?m)^\s*commands:\s*$'){'STDIO_COMMAND'}else{'UNKNOWN'}
$runtimePresent=Test-Path -LiteralPath $runtime -PathType Leaf
$help='';$adminHelp=''
if($runtimePresent){try{$help=((@(& $runtime --help 2>&1)|ForEach-Object{[string]$_})-join [Environment]::NewLine)}catch{$help=[string]$_.Exception.Message};try{$adminHelp=((@(& $runtime admin tunnels create --help 2>&1)|ForEach-Object{[string]$_})-join [Environment]::NewLine)}catch{$adminHelp=[string]$_.Exception.Message}}
$task=$null;try{$task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop}catch{}
$action=$null;if($task -and @($task.Actions).Count -gt 0){$action=$task.Actions[0]}
[ordered]@{
 schema='v49.p5.dedicated-tunnel-capability-reconcile.v1';readback_only=$true
 prior_request=[ordered]@{request_id=$requestId;present=[bool](Test-Path -LiteralPath $receiptPath -PathType Leaf);state=P $rr 'state';operation_id=P $rr 'operation_id';attempt_id=P $rr 'attempt_id';attempt_epoch=P $rr 'attempt_epoch';timed_out=P $rr 'timed_out';exit_code=P $rr 'exit_code';side_effect_state=P $rr 'side_effect_state';script_sha256=P $rr 'script_sha256';stdout_bytes=P $rr 'stdout_bytes';stderr_bytes=P $rr 'stderr_bytes';started_at_utc=P $rr 'started_at_utc';finished_at_utc=P $rr 'finished_at_utc'}
 profile_present=[bool](Test-Path -LiteralPath $profile -PathType Leaf);tunnel_id_present=[bool]$id;tunnel_id=$id;normalized_tunnel_binding_id=if($id){$id.ToUpperInvariant()}else{$null};current_mcp_transport=$mode
 profile_has_mcp_client_cert=[bool]($raw -match '(?m)^\s*client_cert:\s*');profile_has_mcp_client_key=[bool]($raw -match '(?m)^\s*client_key:\s*');profile_has_ca_bundle=[bool]($raw -match '(?m)^\s*ca_bundle:\s*')
 runtime_present=[bool]$runtimePresent;runtime_supports_server_url=[bool]($help -match '(?i)mcp[.-]server-url|server-url');runtime_supports_mcp_client_cert=[bool]($help -match '(?i)mcp[.-]client-cert|client-cert');runtime_supports_mcp_client_key=[bool]($help -match '(?i)mcp[.-]client-key|client-key');runtime_supports_admin_tunnel_create=[bool]($adminHelp -match '(?i)create|tunnel')
 openai_admin_key_env_present=[bool](-not [string]::IsNullOrWhiteSpace($env:OPENAI_ADMIN_KEY));control_plane_api_key_env_present=[bool](-not [string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY));task_present=[bool]$task;task_state=if($task){[string]$task.State}else{$null};task_action_executable=if($action){[string]$action.Execute}else{$null}
 no_secret_values_output=$true;no_file_mutation=$true;no_task_mutation=$true;no_p4_mutation=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')
}|ConvertTo-Json -Depth 6 -Compress
