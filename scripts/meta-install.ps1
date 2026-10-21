param([string]$Destination = (Join-Path $PSScriptRoot '../third_party/meta/bin/windows-amd64'))
$ErrorActionPreference='Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows amd64 required' }
$uri='https://github.com/MetaCubeX/mihomo/releases/download/v1.19.32/mihomo-windows-amd64-compatible-v1.19.32.zip'
$hash='974a4d7ad69aed27aa2e8f91d61113573c14dadb14562c63e58effabf59816f0'
$Destination=[IO.Path]::GetFullPath($Destination)
[IO.Directory]::CreateDirectory($Destination) | Out-Null
$archive=Join-Path $Destination 'mihomo-v1.19.32.zip'
$pending=Join-Path $Destination 'mihomo.exe.pending'
$target=Join-Path $Destination 'mihomo.exe'
if(Test-Path -LiteralPath $target){throw 'Target exists; no overwrite. Use a new explicit directory for staged upgrade.'}
$handler=[Net.Http.HttpClientHandler]::new(); $handler.UseProxy=$false
$client=[Net.Http.HttpClient]::new($handler);$client.Timeout=[TimeSpan]::FromSeconds(120);$cts=[Threading.CancellationTokenSource]::new(120000)
try {
 $response=$client.GetAsync($uri,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cts.Token).GetAwaiter().GetResult();$response.EnsureSuccessStatusCode() | Out-Null
 if($response.Content.Headers.ContentLength -gt 33554432){throw 'Archive too large'}
 $input=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$output=[IO.File]::Open($archive,[IO.FileMode]::CreateNew)
 try{$buf=[byte[]]::new(65536);$total=0;$deadline=[DateTime]::UtcNow.AddSeconds(120);while(($n=$input.ReadAsync($buf,0,$buf.Length,$cts.Token).GetAwaiter().GetResult()) -gt 0){$total+=$n;if($total -gt 33554432 -or [DateTime]::UtcNow -gt $deadline){throw 'Download bound exceeded'};$output.Write($buf,0,$n)}}finally{$input.Dispose();$output.Dispose()}
} finally {$client.Dispose();$handler.Dispose();$cts.Dispose()}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash){throw 'Official pinned archive checksum mismatch; not extracted'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{
 $entries=@($zip.Entries | Where-Object {$_.Name -like '*.exe'})
 if($entries.Count -ne 1 -or $entries[0].Length -gt 134217728){throw 'Unexpected archive contents'}
 # Never use entry paths: extract only the sole executable to our explicit path.
 $src=$entries[0].Open();$dst=[IO.File]::Open($pending,[IO.FileMode]::CreateNew)
 try{$src.CopyTo($dst);$dst.Flush($true)}finally{$src.Dispose();$dst.Dispose()}
}finally{$zip.Dispose()}
if((Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash.ToLowerInvariant() -ne '04f8d7fc2b314771e1ecbf15951d59f0e1cb7914503c88cfb6972ff6a824e314'){throw 'Extracted executable checksum mismatch'}
Move-Item -LiteralPath $pending -Destination $target
[pscustomobject]@{version='v1.19.32';archive_sha256=$hash;binary_sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant();path=$target} | ConvertTo-Json

