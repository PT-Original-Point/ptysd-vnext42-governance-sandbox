Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$client='C:\ProgramData\PTYSD\MCP\tunnel\full\v0.0.14\tunnel-client.exe'
$key='C:\ProgramData\PTYSD\MCP\secrets\control-plane-api-key.txt'
$present=Test-Path -LiteralPath $client -PathType Leaf
if(-not $present){[ordered]@{schema='v49.p5.full-tunnel-client-admin-capability.v1';readback_only=$true;client_present=$false;control_plane_key_file_present=[bool](Test-Path -LiteralPath $key -PathType Leaf);no_secret_value_output=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress;exit 0}
function Probe([string]$argLine){
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=$client
  $psi.Arguments=$argLine
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $p=New-Object Diagnostics.Process
  $p.StartInfo=$psi
  if(-not $p.Start()){throw 'PROBE_START_FAILED'}
  $ot=$p.StandardOutput.ReadToEndAsync();$et=$p.StandardError.ReadToEndAsync()
  $exited=$p.WaitForExit(5000)
  if(-not $exited){try{$p.Kill()}catch{};try{[void]$p.WaitForExit(1000)}catch{}}
  $out='';$err='';try{$out=[string]$ot.GetAwaiter().GetResult()}catch{};try{$err=[string]$et.GetAwaiter().GetResult()}catch{}
  $code=if($exited){[int]$p.ExitCode}else{$null}
  try{$p.Dispose()}catch{}
  $txt=$out+[Environment]::NewLine+$err
  [ordered]@{exit_code=$code;timed_out=[bool](-not $exited);profile_file=[bool]($txt -match '(?i)--profile-file');api_key=[bool]($txt -match '(?i)--api-key(\s|,|$)');api_key_file=[bool]($txt -match '(?i)--api-key-file');name=[bool]($txt -match '(?i)--name');json=[bool]($txt -match '(?i)--json');output=[bool]($txt -match '(?i)--output');account=[bool]($txt -match '(?i)--account');tunnel_word=[bool]($txt -match '(?i)tunnel');create_word=[bool]($txt -match '(?i)create')}
}
$admin=Probe 'admin tunnels create --help'
$root=Probe '--help'
[ordered]@{schema='v49.p5.full-tunnel-client-admin-capability.v1';readback_only=$true;client_present=$true;client_sha256=(Get-FileHash -LiteralPath $client -Algorithm SHA256).Hash.ToLowerInvariant();control_plane_key_file_present=[bool](Test-Path -LiteralPath $key -PathType Leaf);control_plane_key_file_nonempty=if(Test-Path -LiteralPath $key -PathType Leaf){((Get-Item -LiteralPath $key).Length -gt 0)}else{$false};admin_create=$admin;root=$root;admin_tunnel_create_supported=[bool]($admin.exit_code -eq 0 -and -not $admin.timed_out -and $admin.tunnel_word);secure_key_file_argument_supported=[bool]$admin.api_key_file;no_help_text_output=$true;no_secret_value_output=$true;no_file_mutation=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
