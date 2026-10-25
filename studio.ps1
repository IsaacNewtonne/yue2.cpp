<#
.SYNOPSIS
    YuE2 Studio launcher: colourful banner, status check, server start, browser.

.DESCRIPTION
    Prints the YUE2 STUDIO banner and a status block (server, URL, build,
    model files, GPU VRAM, Ollama), starts the local server if it is not
    already listening, waits for the port, then opens the studio in the
    browser. GPU and Ollama checks are optional and skipped when absent.

    The server is started with server.cmd when it matches the requested
    host and port, otherwise yue-server.exe is started directly with the
    model files named in server.cmd or found in the models folder.

    This file is pure ASCII on purpose: the banner glyphs are built from
    character codes, so Windows PowerShell 5.1 and PowerShell 7 read it in
    any encoding.

.EXAMPLE
    .\studio.ps1                   # start if needed, open the browser
    .\studio.ps1 -NoBrowser        # status and start only
    .\studio.ps1 -Port 8088 -Host 0.0.0.0

    Environment: YUE2_NO_BROWSER=1 skips the browser,
    YUE2_COLOR=truecolor|basic forces a colour mode.
#>
[CmdletBinding()]
param(
    [int]$Port = 8087,
    [Alias('Host')][string]$ListenHost = '127.0.0.1',
    [switch]$NoBrowser
)

$clock   = [Diagnostics.Stopwatch]::StartNew()
$repoDir = $PSScriptRoot
$esc     = [char]27
$probeHost = if ($ListenHost -in @('0.0.0.0', '::', '*', 'localhost', '')) { '127.0.0.1' } else { $ListenHost }
$urlHost   = if ($probeHost -eq '127.0.0.1') { 'localhost' } else { $ListenHost }
$url       = "http://${urlHost}:$Port"

$vt = $false
try { $vt = [bool]$Host.UI.SupportsVirtualTerminal } catch { }
if ($env:WT_SESSION) { $vt = $true }
if ($env:YUE2_COLOR -eq 'truecolor') { $vt = $true }
if ($env:YUE2_COLOR -eq 'basic') { $vt = $false }

$width = 120
try { $width = $Host.UI.RawUI.WindowSize.Width } catch { }
if (-not $width -or $width -lt 20) { $width = 120 }

# ---- banner: magenta -> cyan -> gold gradient -------------------------------
$art = @(
    '##7   ##7##7   ##7#######7######7     #######7########7##7   ##7######7 ##7 ######7'
    'L##7 ##rj##|   ##|##r====jL====##7    ##r====jL==##r==j##|   ##|##r==##7##|##r===##7'
    ' L####rj ##|   ##|#####7   #####rj    #######7   ##|   ##|   ##|##|  ##|##|##|   ##|'
    '  L##rj  ##|   ##|##r==j  ##r===j     L====##|   ##|   ##|   ##|##|  ##|##|##|   ##|'
    '   ##|   L######rj#######7#######7    #######|   ##|   L######rj######rj##|L######rj'
    '   L=j    L=====j L======jL======j    L======j   L=j    L=====j L=====j L=j L=====j'
)
$glyph = @{ [char]'#' = [char]0x2588; [char]'=' = [char]0x2550; [char]'|' = [char]0x2551
            [char]'7' = [char]0x2557; [char]'r' = [char]0x2554; [char]'j' = [char]0x255D; [char]'L' = [char]0x255A }
$stops = @(@(255, 46, 200), @(0, 224, 255), @(255, 196, 0))   # magenta, cyan, gold
function Get-Gradient([double]$t) {
    $seg = if ($t -lt 0.5) { 0 } else { 1 }
    $u = if ($seg -eq 0) { $t * 2 } else { ($t - 0.5) * 2 }
    $a = $stops[$seg]; $b = $stops[$seg + 1]
    '{0};{1};{2}' -f [int]($a[0] + ($b[0] - $a[0]) * $u), [int]($a[1] + ($b[1] - $a[1]) * $u), [int]($a[2] + ($b[2] - $a[2]) * $u)
}

Write-Host ""
if ($width -lt 90) {
    # narrow window: one spaced-out line instead of the big letters
    $title = 'Y U E 2   S T U D I O'
    if ($vt) {
        $sb = New-Object Text.StringBuilder
        for ($i = 0; $i -lt $title.Length; $i++) {
            [void]$sb.Append("$esc[1;38;2;$(Get-Gradient ($i / ($title.Length - 1)))m").Append($title[$i])
        }
        Write-Host ("   " + $sb.ToString() + "$esc[0m")
    } else {
        Write-Host "   Y U E 2  " -ForegroundColor Magenta -NoNewline
        Write-Host " S T U " -ForegroundColor Cyan -NoNewline
        Write-Host "D I O" -ForegroundColor Yellow
    }
} else {
    $cols = $art[0].Length
    foreach ($line in $art) {
        $chars = $line.ToCharArray() | ForEach-Object { if ($glyph.ContainsKey($_)) { $glyph[$_] } else { $_ } }
        if ($vt) {
            $sb = New-Object Text.StringBuilder
            [void]$sb.Append("  ")
            for ($i = 0; $i -lt $chars.Count; $i++) {
                if ($i % 2 -eq 0) { [void]$sb.Append("$esc[38;2;$(Get-Gradient ($i / ($cols - 1)))m") }
                [void]$sb.Append($chars[$i])
            }
            Write-Host ($sb.ToString() + "$esc[0m")
        } else {
            $text = -join $chars
            $third = [int]($cols / 3)
            Write-Host ("  " + $text.Substring(0, [Math]::Min($third, $text.Length))) -ForegroundColor Magenta -NoNewline
            if ($text.Length -gt $third) { Write-Host $text.Substring($third, [Math]::Min($third, $text.Length - $third)) -ForegroundColor Cyan -NoNewline }
            if ($text.Length -gt 2 * $third) { Write-Host $text.Substring(2 * $third) -ForegroundColor Yellow -NoNewline }
            Write-Host ""
        }
    }
}
$rule = '  ' + ('-' * 84)
if ($vt) { Write-Host "$esc[38;2;120;120;150m   local AI music studio  ~  YuE2 + SheetSage on your own GPU$esc[0m" }
else { Write-Host "   local AI music studio  ~  YuE2 + SheetSage on your own GPU" -ForegroundColor DarkGray }
Write-Host $rule -ForegroundColor DarkGray

# ---- helpers ------------------------------------------------------------------
function Write-Status([string]$tag, [string]$label, [string]$text, [string]$note = '') {
    switch ($tag) {
        'OK'    { $color = 'Green';      $rgb = '80;220;120' }
        '..'    { $color = 'DarkYellow'; $rgb = '255;176;0' }
        'X'     { $color = 'Red';        $rgb = '255;85;85' }
        default { $color = 'DarkGray';   $rgb = '140;140;140' }
    }
    $box = ('[' + $tag + ']').PadRight(5)
    if ($vt) { Write-Host ("  $esc[1;38;2;${rgb}m$box$esc[0m ") -NoNewline } else { Write-Host "  $box " -ForegroundColor $color -NoNewline }
    Write-Host ($label.PadRight(8)) -ForegroundColor Gray -NoNewline
    Write-Host $text -ForegroundColor White -NoNewline
    if ($note) { Write-Host "  $note" -ForegroundColor DarkGray } else { Write-Host "" }
}
function Test-StudioPort {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($probeHost, $Port, $null, $null)
        return ($async.AsyncWaitHandle.WaitOne(250) -and $client.Connected)
    } catch { return $false } finally { $client.Close() }
}
function Get-Relative([string]$path) {
    if ($path.StartsWith($repoDir, [StringComparison]::OrdinalIgnoreCase)) { return $path.Substring($repoDir.Length).TrimStart('\', '/') }
    return $path
}

# ---- what server.cmd launches ------------------------------------------------
$serverCmd = Join-Path $repoDir 'server.cmd'
$cmdText = if (Test-Path $serverCmd) { Get-Content $serverCmd -Raw } else { '' }
$cmdExe  = if ($cmdText -match '(?im)^\s*"?([^\s"]*yue-server\.exe)') { $Matches[1] } else { '' }
$cmdPort = if ($cmdText -match '--port\s+(\d+)') { [int]$Matches[1] } else { 8087 }
$cmdHost = if ($cmdText -match '--host\s+(\S+)') { $Matches[1] } else { '127.0.0.1' }

# server exe: the one named in server.cmd, else the newest build\*\yue-server.exe
$exe = $null
if ($cmdExe) {
    $candidate = if ([IO.Path]::IsPathRooted($cmdExe)) { $cmdExe } else { Join-Path $repoDir $cmdExe }
    if (Test-Path $candidate) { $exe = (Resolve-Path $candidate).Path }
}
if (-not $exe) {
    $exe = Get-ChildItem (Join-Path $repoDir 'build') -Filter 'yue-server.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}

# model files: the ones named in server.cmd, else detected in models\
$modelArgs = [ordered]@{}
foreach ($m in [regex]::Matches($cmdText, '--(model|vae|transcriber)\s+(\S+)')) { $modelArgs[$m.Groups[1].Value] = $m.Groups[2].Value }
if (-not $modelArgs.Count) {
    $modelsDir = Join-Path $repoDir 'models'
    $ggufs = @(Get-ChildItem $modelsDir -Filter '*.gguf' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    $vae   = $ggufs | Where-Object { $_.Name -match 'vae' } | Select-Object -First 1
    $tr    = $ggufs | Where-Object { $_.Name -match 'sheetsage|transcri' } | Select-Object -First 1
    $lm    = $ggufs | Where-Object { $_.Name -notmatch 'vae|sheetsage|transcri' } | Select-Object -First 1
    if ($lm)  { $modelArgs['model'] = Get-Relative $lm.FullName }
    if ($vae) { $modelArgs['vae'] = Get-Relative $vae.FullName }
    if ($tr)  { $modelArgs['transcriber'] = Get-Relative $tr.FullName }
}

# ---- status block ---------------------------------------------------------------
$failed  = $false
$running = Test-StudioPort
$proc    = Get-Process yue-server -ErrorAction SilentlyContinue | Select-Object -First 1
$useCmd  = $cmdText -and $cmdPort -eq $Port -and $cmdHost -eq $ListenHost -and $cmdExe -and $exe -and
           ((Join-Path $repoDir $cmdExe) -eq $exe -or $cmdExe -eq $exe)

if ($running) {
    $pidText = if ($proc) { "PID $($proc.Id)" } else { '' }
    Write-Status 'OK' 'Server' 'already running' $pidText
} elseif (-not $exe) {
    Write-Status 'X' 'Server' 'no yue-server.exe found under build\'
    Write-Host "          Build it first: buildcuda.cmd (NVIDIA) or buildvulkan.cmd, see README > Build." -ForegroundColor Red
    $failed = $true
} else {
    $how = if ($useCmd) { 'new window: server.cmd' } else { 'new window: ' + (Get-Relative $exe) }
    Write-Status '..' 'Server' 'starting...' $how
}
Write-Status 'OK' 'URL' $url

# build in use: the running process if any, else what will be launched
if ($running -and $proc -and $proc.Path) {
    $build = Split-Path (Get-Relative $proc.Path) -Parent
    if ($exe -and $proc.Path -ne $exe) { Write-Status '..' 'Build' $build ('server.cmd now points to ' + (Split-Path (Get-Relative $exe) -Parent) + ' (restart to switch)') }
    else { Write-Status 'OK' 'Build' $build }
} elseif ($exe) {
    Write-Status 'OK' 'Build' (Split-Path (Get-Relative $exe) -Parent)
} elseif (-not $failed) {
    Write-Status 'X' 'Build' 'no yue-server.exe found under build\'
}

# model files
$missing = @(); $bytes = 0; $names = @()
foreach ($m in $modelArgs.Values) {
    $f = if ([IO.Path]::IsPathRooted($m)) { $m } else { Join-Path $repoDir $m }
    if (Test-Path $f) { $bytes += (Get-Item $f).Length; $names += [IO.Path]::GetFileNameWithoutExtension($f) } else { $missing += $m }
}
if ($missing.Count) { Write-Status 'X' 'Models' ('missing: ' + ($missing -join ', ')) 'see README > Download models' }
elseif ($names.Count) { Write-Status 'OK' 'Models' ($names -join ', ') ('{0:N1} GB' -f ($bytes / 1GB)) }
else { Write-Status 'X' 'Models' 'no .gguf files in models\' 'see README > Download models' }

# GPU / VRAM: optional, skipped silently without nvidia-smi
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue | Select-Object -First 1
if ($smi) {
    $gpu = & $smi.Source --query-gpu=name,memory.free,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if ($gpu -and ($gpu -split ',\s*').Count -ge 3) {
        $g = $gpu -split ',\s*'
        $free = [double]$g[1] / 1024; $total = [double]$g[2] / 1024
        $tag = if ($free -ge 5) { 'OK' } else { '..' }
        Write-Status $tag 'GPU' ($g[0] -replace '^NVIDIA (GeForce )?', '') ('{0:N1} / {1:N1} GB VRAM free' -f $free, $total)
    }
}

# Ollama: optional, skipped silently when it is not running
try {
    $web = [Net.WebRequest]::Create('http://127.0.0.1:11434/api/ps')
    $web.Timeout = 400
    $response = $web.GetResponse()
    $reader = New-Object IO.StreamReader ($response.GetResponseStream())
    $ps = $reader.ReadToEnd() | ConvertFrom-Json
    $reader.Close(); $response.Close()
    $loaded = @($ps.models | Where-Object { $_ })
    if ($loaded.Count) {
        $vram = ($loaded | Measure-Object -Property size_vram -Sum).Sum / 1GB
        Write-Status '..' 'Ollama' (($loaded | ForEach-Object { $_.name }) -join ', ') ('{0:N1} GB VRAM; unloaded before each song' -f $vram)
    } else { Write-Status 'OK' 'Ollama' 'no models loaded' }
} catch { }

Write-Host $rule -ForegroundColor DarkGray
$clock.Stop()
if ($failed) { Write-Host ""; exit 1 }

# ---- start the server if needed and wait for the port ----------------------
if (-not $running) {
    if ($useCmd) {
        Start-Process -FilePath 'cmd.exe' -ArgumentList "/k `"$serverCmd`"" -WorkingDirectory $repoDir
    } else {
        # same environment server.cmd sets up: vocal tools venv and the exe dir
        $oldPath = $env:PATH
        $venv = Join-Path $repoDir '.venv-vocal\Scripts'
        $env:PATH = ((@($venv, (Split-Path $exe -Parent)) | Where-Object { Test-Path $_ }) + $oldPath) -join [IO.Path]::PathSeparator
        $exeArgs = @('--host', $ListenHost, '--port', $Port)
        foreach ($k in $modelArgs.Keys) { $exeArgs += @("--$k", "`"$($modelArgs[$k])`"") }
        try { Start-Process -FilePath $exe -ArgumentList $exeArgs -WorkingDirectory $repoDir }
        finally { $env:PATH = $oldPath }
    }
    $wait = [Diagnostics.Stopwatch]::StartNew()
    Write-Host "  [..]  " -ForegroundColor DarkYellow -NoNewline
    Write-Host "Loading models " -ForegroundColor Gray -NoNewline
    while (-not (Test-StudioPort) -and $wait.Elapsed.TotalSeconds -lt 30) {
        Write-Host "." -ForegroundColor DarkYellow -NoNewline
        Start-Sleep -Milliseconds 750
    }
    if (Test-StudioPort) { Write-Host (" ready in {0:N0} s" -f $wait.Elapsed.TotalSeconds) -ForegroundColor Green }
    else { Write-Host " still loading; the page will connect when it is up" -ForegroundColor DarkYellow }
}

if ($NoBrowser -or $env:YUE2_NO_BROWSER -eq '1') {
    Write-Status '--' 'Browser' 'skipped (-NoBrowser)' ('status in {0:N2} s' -f $clock.Elapsed.TotalSeconds)
} else {
    Write-Status 'OK' 'Browser' "opening $url" ('status in {0:N2} s' -f $clock.Elapsed.TotalSeconds)
    Start-Process $url
}
Write-Host ""
exit 0
