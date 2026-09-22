Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$dir='C:\ProgramData\PTYSD\MCP\FactoryMCP\state\exec-receipts'
$ids=@('24d877f9bd1c4b48b2e6c1b4ad992a1c','d62db2941ff44d1f9ced2f45309422db')
$out=@()
foreach($id in $ids){
  $p=Join-Path $dir ($id+'.json')
  if(!(Test-Path -LiteralPath $p -PathType Leaf)){ $out += [ordered]@{request_id=$id;present=$false}; continue }
  $r=Get-Content -LiteralPath $p -Raw | ConvertFrom-Json -ErrorAction Stop
  $stderr=if($r.PSObject.Properties.Name -contains 'stderr'){[string]$r.stderr}else{''}
  $bytes=[Text.Encoding]::UTF8.GetBytes($stderr)
  $h=[Security.Cryptography.SHA256]::Create()
  try{$digest=([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}
  $bounded=$stderr
  if($bounded.Length -gt 1200){$bounded=$bounded.Substring(0,1200)}
  $out += [ordered]@{request_id=$id;present=$true;operation_id=[string]$r.operation_id;exit_code=$r.exit_code;timed_out=$r.timed_out;stderr_bytes=$r.stderr_bytes;stderr_sha256=$digest;stderr_bounded=$bounded}
}
[ordered]@{schema='v49.p5.tunnel-cli-capability-stderr-readback.v1';readback_only=$true;receipts=$out;no_secret_value_expected=$true;no_file_mutation=$true;observed_at_utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
