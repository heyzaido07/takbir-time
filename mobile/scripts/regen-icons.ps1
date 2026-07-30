# Regenerate Android launcher icons from playstore-kit master.
#
# Why this exists: the previous foreground was painted edge-to-edge on
# the 108dp adaptive-icon canvas, so Android's round/squircle mask
# (which clips ~18% off each side) sliced visible logo content. Adaptive
# icons need the foreground art inside a ~66dp circle (the "safe zone"),
# leaving the outer ~21dp transparent for masks to bite into.
#
# This script:
#   1. Reads playstore-kit/icons/source-icon-1024.png as the master.
#   2. For each density, writes ic_launcher_foreground.png at 108dp canvas
#      with the logo scaled to 60% and centered on a transparent bg.
#   3. Writes ic_launcher.png and ic_launcher_round.png (legacy, pre-O)
#      at 48dp display size, scaled from the same master.
#
# Run from mobile/: pwsh scripts/regen-icons.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$src  = Join-Path (Split-Path -Parent $root) 'playstore-kit\icons\source-icon-1024.png'
$res  = Join-Path $root 'android\app\src\main\res'

if (-not (Test-Path $src)) { throw "Master icon not found at $src" }

$source = [System.Drawing.Image]::FromFile($src)
Write-Host "Master: $($source.Width)x$($source.Height) from $src"

# Density: name → multiplier (against 1dp = 1px at mdpi).
# Adaptive canvas is 108dp; legacy display is 48dp.
$densities = @(
    @{ name = 'mdpi';    mult = 1.0 },
    @{ name = 'hdpi';    mult = 1.5 },
    @{ name = 'xhdpi';   mult = 2.0 },
    @{ name = 'xxhdpi';  mult = 3.0 },
    @{ name = 'xxxhdpi'; mult = 4.0 }
)

# Adaptive foreground: full 108dp canvas, logo at 60% centered.
# 60% matches the 66dp safe-zone diameter the Material guidance pins
# for round masks (66/108 ≈ 0.611 — round down to 0.6 for breathing room).
$ADAPTIVE_DP = 108
$LEGACY_DP   = 48
$FG_SCALE    = 0.60

function Write-PngCanvas {
    param(
        [int]$canvasPx,
        [double]$artScale,           # fraction of canvas the art occupies
        [System.Drawing.Color]$bg,   # use Color.Transparent for adaptive fg
        [bool]$circleMask = $false,
        [string]$outPath
    )
    $bmp = New-Object System.Drawing.Bitmap $canvasPx, $canvasPx, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($bg)

    if ($circleMask) {
        # Circular clip so the art is round (legacy ic_launcher_round.png).
        $clipPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $clipPath.AddEllipse(0, 0, $canvasPx, $canvasPx)
        $g.SetClip($clipPath)
    }

    $artPx = [int]($canvasPx * $artScale)
    $offset = [int](($canvasPx - $artPx) / 2)
    $g.DrawImage($source, $offset, $offset, $artPx, $artPx)

    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  wrote $outPath ($canvasPx x $canvasPx, art=$artPx px)"
}

foreach ($d in $densities) {
    $folder = Join-Path $res ("mipmap-" + $d.name)
    if (-not (Test-Path $folder)) { throw "Missing density dir: $folder" }
    Write-Host "=== mipmap-$($d.name) (mult=$($d.mult)x) ==="

    # Adaptive foreground: 108dp canvas, transparent bg, logo at 60%.
    $fgPx = [int]([Math]::Round($ADAPTIVE_DP * $d.mult))
    Write-PngCanvas -canvasPx $fgPx -artScale $FG_SCALE `
        -bg ([System.Drawing.Color]::Transparent) `
        -outPath (Join-Path $folder 'ic_launcher_foreground.png')

    # Legacy square: 48dp canvas, brand-green bg, logo at 70% (more
    # visible on old launchers that don't apply their own mask).
    $legPx = [int]([Math]::Round($LEGACY_DP * $d.mult))
    $brandBg = [System.Drawing.Color]::FromArgb(0xFF, 0x0D, 0x28, 0x18)  # #0d2818
    Write-PngCanvas -canvasPx $legPx -artScale 0.70 `
        -bg $brandBg `
        -outPath (Join-Path $folder 'ic_launcher.png')

    # Legacy round: same content, circular clip.
    Write-PngCanvas -canvasPx $legPx -artScale 0.70 `
        -bg ([System.Drawing.Color]::Transparent) `
        -circleMask $true `
        -outPath (Join-Path $folder 'ic_launcher_round.png')
}

$source.Dispose()
Write-Host "`nDone. Re-run cap sync + gradle build to pick up new icons."
