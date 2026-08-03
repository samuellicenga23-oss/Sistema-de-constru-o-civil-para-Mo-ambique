param(
    [string]$Source = "apps/web/brand/SIGO-logo-oficial-master.png",
    [string]$OutputDirectory = "apps/web/public/brand"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$expectedWidth = 4118
$expectedHeight = 2759
$sourceCrop = [System.Drawing.Rectangle]::new(824, 1025, 2470, 709)
$taglineRegion = [System.Drawing.Rectangle]::new(776, 575, 1694, 134)
$markCrop = [System.Drawing.Rectangle]::new(824, 1025, 689, 709)

function Save-ResizedPng {
    param(
        [System.Drawing.Image]$Image,
        [string]$Path,
        [int]$Width,
        [int]$Height
    )

    $output = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $output.SetResolution(96, 96)
        $graphics = [System.Drawing.Graphics]::FromImage($output)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.DrawImage($Image, [System.Drawing.Rectangle]::new(0, 0, $Width, $Height))
        }
        finally {
            $graphics.Dispose()
        }
        $output.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $output.Dispose()
    }
}

function New-MarkCanvas {
    param(
        [System.Drawing.Image]$Mark,
        [int]$Size,
        [double]$Coverage
    )

    $canvas = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $targetHeight = [int][Math]::Round($Size * $Coverage)
        $targetWidth = [int][Math]::Round($targetHeight * $Mark.Width / $Mark.Height)
        $x = [int][Math]::Round(($Size - $targetWidth) / 2)
        $y = [int][Math]::Round(($Size - $targetHeight) / 2)
        $graphics.DrawImage($Mark, [System.Drawing.Rectangle]::new($x, $y, $targetWidth, $targetHeight))
    }
    finally {
        $graphics.Dispose()
    }
    return $canvas
}

$resolvedSource = (Resolve-Path -LiteralPath $Source).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$master = [System.Drawing.Bitmap]::FromFile($resolvedSource)
try {
    if ($master.Width -ne $expectedWidth -or $master.Height -ne $expectedHeight) {
        throw "O ficheiro mestre deve ter ${expectedWidth}x${expectedHeight}px; recebeu $($master.Width)x$($master.Height)px."
    }

    $lockup = $master.Clone($sourceCrop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        Save-ResizedPng -Image $lockup -Path (Join-Path $OutputDirectory "sigo-logo-oficial.png") -Width 1600 -Height 459

        $compact = $lockup.Clone()
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($compact)
            try {
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.FillRectangle([System.Drawing.Brushes]::Transparent, $taglineRegion)
            }
            finally {
                $graphics.Dispose()
            }
            Save-ResizedPng -Image $compact -Path (Join-Path $OutputDirectory "sigo-logo-compacto.png") -Width 1200 -Height 344
        }
        finally {
            $compact.Dispose()
        }
    }
    finally {
        $lockup.Dispose()
    }

    $mark = $master.Clone($markCrop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        Save-ResizedPng -Image $mark -Path (Join-Path $OutputDirectory "sigo-simbolo.png") -Width 512 -Height 527

        foreach ($icon in @(
            @{ Size = 64; Coverage = 0.78; Path = "apps/web/public/favicon.png" },
            @{ Size = 192; Coverage = 0.74; Path = "apps/web/public/icon-192.png" },
            @{ Size = 512; Coverage = 0.74; Path = "apps/web/public/icon-512.png" },
            @{ Size = 512; Coverage = 0.58; Path = "apps/web/public/icon-maskable-512.png" },
            @{ Size = 512; Coverage = 0.74; Path = "apps/web/public/sigo-icon.png" }
        )) {
            $canvas = New-MarkCanvas -Mark $mark -Size $icon.Size -Coverage $icon.Coverage
            try {
                $canvas.Save($icon.Path, [System.Drawing.Imaging.ImageFormat]::Png)
            }
            finally {
                $canvas.Dispose()
            }
        }
    }
    finally {
        $mark.Dispose()
    }
}
finally {
    $master.Dispose()
}

Write-Host "Activos oficiais SIGO gerados em $OutputDirectory (fundo transparente)."
