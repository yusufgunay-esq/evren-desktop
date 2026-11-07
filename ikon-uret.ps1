# EVREN Desktop simge üretici: SVG kaynaklarından ikon.png (256 px) ve 7 katmanlı ikon.ico (16..256 px) üretir.
$ErrorActionPreference = 'Stop'
$kok = $PSScriptRoot
$taslak = Join-Path $kok 'logo\_taslak'
$svgBuyuk = Join-Path $taslak 'ikon-256.svg'
$svgKucuk = Join-Path $taslak 'ikon-16-24.svg'

# @resvg/resvg-js-cli paketini npx önbelleğinde hazırla
$bin = Get-Item "$env:LOCALAPPDATA\npm-cache\_npx\*\node_modules\.bin\resvg-js-cli.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $bin) {
    $null = & npx.cmd -y @resvg/resvg-js-cli --version 2>$null
    $bin = Get-Item "$env:LOCALAPPDATA\npm-cache\_npx\*\node_modules\.bin\resvg-js-cli.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}

$gecici = Join-Path ([System.IO.Path]::GetTempPath()) ("evren-ikon-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gecici -Force | Out-Null

try {
    $boyutlar = @(16, 24, 32, 48, 64, 128, 256)
    $pngVerileri = @{}

    foreach ($b in $boyutlar) {
        $kaynak = if ($b -le 24) { $svgKucuk } else { $svgBuyuk }
        $cikti = Join-Path $gecici "ikon-$b.png"
        if ($bin) {
            & $bin --log-level off --no-system-font --fit-width $b --fit-height $b $kaynak $cikti
        } else {
            & npx.cmd -y @resvg/resvg-js-cli --log-level off --no-system-font --fit-width $b --fit-height $b $kaynak $cikti
        }
        if (-not (Test-Path $cikti)) { throw "PNG uretilemedi: $b px" }
        $pngVerileri[$b] = [System.IO.File]::ReadAllBytes($cikti)
    }

    # 256 px -> ikon.png
    $ikonPngYol = Join-Path $kok 'ikon.png'
    [System.IO.File]::WriteAllBytes($ikonPngYol, $pngVerileri[256])

    # 7 katmanlı (16, 24, 32, 48, 64, 128, 256) -> ikon.ico
    $ikonIcoYol = Join-Path $kok 'ikon.ico'
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)

    # ICONDIR başlığı (6 bayt)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$boyutlar.Count)

    $ofset = 6 + ($boyutlar.Count * 16)
    foreach ($b in $boyutlar) {
        $veri = $pngVerileri[$b]
        $ebatByte = if ($b -ge 256) { [byte]0 } else { [byte]$b }
        $bw.Write($ebatByte)                  # bWidth
        $bw.Write($ebatByte)                  # bHeight
        $bw.Write([byte]0)                    # bColorCount
        $bw.Write([byte]0)                    # bReserved
        $bw.Write([uint16]1)                  # wPlanes
        $bw.Write([uint16]32)                 # wBitCount
        $bw.Write([uint32]$veri.Length)       # dwBytesInRes
        $bw.Write([uint32]$ofset)             # dwImageOffset
        $ofset += $veri.Length
    }

    foreach ($b in $boyutlar) {
        $bw.Write($pngVerileri[$b])
    }

    $bw.Flush()
    [System.IO.File]::WriteAllBytes($ikonIcoYol, $ms.ToArray())
    $bw.Close()
    $ms.Close()

    Write-Output "ikon.png (256 px) ve ikon.ico ($($boyutlar -join ', ') px) yazildi"
} finally {
    Remove-Item -Path $gecici -Recurse -Force -ErrorAction SilentlyContinue
}
