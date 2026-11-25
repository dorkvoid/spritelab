param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$rootFull = [System.IO.Path]::GetFullPath($Root)
$prefix = "http://localhost:$Port/"

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.ttf'  = 'font/ttf'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "SPRITELAB dev server running at $prefix (serving $rootFull)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $urlPath = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($urlPath -eq '/' -or $urlPath -eq '') { $urlPath = '/index.html' }
      $relPath = $urlPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relPath))

      if (-not $fullPath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
        $res.ContentType = 'text/plain; charset=utf-8'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $res.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
        $res.Headers['Cache-Control'] = 'no-store'
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $res.StatusCode = 200
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      try {
        $res.StatusCode = 500
      } catch {}
    } finally {
      try { $res.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
