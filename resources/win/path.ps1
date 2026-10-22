# Adiciona (ou remove, com -Remove) uma pasta do PATH do usuário. Usado pelo instalador do Lezx Code.
param([Parameter(Mandatory = $true)][string]$Dir, [switch]$Remove)
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $current) { $current = '' }
$parts = @($current -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $Dir.TrimEnd('\')) })
if (-not $Remove) { $parts += $Dir }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
