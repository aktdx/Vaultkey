param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

$resolvedPath = (Resolve-Path $ExecutablePath).Path
$protocolKey = 'HKCU:\Software\Classes\vaultkey'
$commandKey = Join-Path $protocolKey 'shell\open\command'

New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolKey -Value 'URL:VaultKey Secure Viewer'
New-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -Path $commandKey -Value ('"{0}" "%1"' -f $resolvedPath)
Write-Host "Registered vaultkey:// for $resolvedPath (current Windows user only)."
