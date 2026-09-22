Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$runtime='C:\ProgramData\PTYSD\MCP\tunnel\v0.0.14\tunnel-client.exe'
if(!(Test-Path -LiteralPath $runtime -PathType Leaf)){throw 'TUNNEL_RUNTIME_MISSING'}
function Probe([string]$argLine){
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=$runtime
  $psi.Arguments=$argLine
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $p=New-Object Diagnostics.Process
  $p.StartInfo=$psi
  if(-not $p.Start()){throw 'PROBE_START_FAILED'}
  $ot=$p.StandardOutput.ReadToEndAsync()
  $et=$p.StandardError.ReadToEndAsync()
  $exited=$p.WaitForExit(5000)
  if(-not $exited){try{$p.Kill()}catch{};try{[void]$p.WaitForExit(1000)}catch{}}
  $out='';$err=''
  try{$out=[string]$ot.GetAwaiter().GetResult()}catch{}
  try{$err=[string]$et.GetAwaiter().GetResult()}catch{}
  $code=if($exited){[int]$p.ExitCode}else{$null}
  try{$p.Dispose()}catch{}
  $txt=$out+[Environment]::NewLine+$err
  return [ordered]@{exit_code=$code;timed_out=[bool](-not $exited);profile_file=[bool]($txt -match '(?i)--profile-file');api_key=[bool]($txt -match '(?i)--api-key');api_key_file=[bool]($txt -match '(?i)--api-key-file');name=[bool]($txt -match '(?i)--name');json=[bool]($txt -match '(?i)--json');server_url=[bool]($txt -match '(?i)server-url');client_cert=[bool]($txt -match '(?i)client-cert');client_key=[bool]($txt -match '(?i)client-key');ca_bundle=[bool]($txt -match '(?i)ca-bundle');create_word=[bool]($txt -match '(?i)create');tunnel_word=[bool]($txt -match '(?i)tunnel')}
}
$root=Probe '--help'
$admin=Probe 'admin tunnels create --help'
$doctor=Probe 'doctor --help'
$run=Probe 'run --help'
[ordered]@{schema='v49.p5.tunnel-cli-capability-probe.v2';readback_only=$true;runtime_sha256=(Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant();root=$root;admin_create=$admin;doctor=$doctor;run=$run;native_http_mtls_supported=[bool](($run.server_url -or $doctor.server_url) -and ($run.client_cert -or $doctor.client_cert) -and ($run.client_key -or $doctor.client_key));admin_tunnel_create_supported=[bool]($admin.create_word -and $admin.tunnel_word -and -not $admin.timed_out);no_help_text_output=$true;no_secret_value_output=$true;no_file_mutation=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
