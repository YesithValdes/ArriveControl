# configurar-vercel.ps1 — Configura las variables de produccion de arrivecontrol
# y despliega. EJECUTAR UNA SOLA VEZ desde esta carpeta:
#   powershell -ExecutionPolicy Bypass -File .\configurar-vercel.ps1

$ErrorActionPreference = 'Stop'
$gestorDir = "c:\Users\alexi\Documents\SmartGadgets\GestorEmpleados"
$arriveDir = "c:\Users\alexi\Documents\Proyectos2026\Software_projects\ArriveControl\attendance-prototype"

# 1. Descargar variables de produccion del gestor (comparten base y secreto de sesion)
$tmp = Join-Path $env:TEMP "gestor-prod-envs.tmp"
Set-Location $gestorDir
vercel env pull --environment=production --yes $tmp
$envs = @{}
Get-Content $tmp | ForEach-Object { if ($_ -match '^([A-Z_]+)="?([^"]*)"?$') { $envs[$Matches[1]] = $Matches[2] } }
Remove-Item $tmp -Force

# Limpieza de un temporal de una sesion anterior (si existe)
Get-ChildItem "$env:LOCALAPPDATA\Temp\claude" -Recurse -Filter "gestor-prod.env" -ErrorAction SilentlyContinue | Remove-Item -Force

# 2. Generar claves nuevas
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$b = New-Object byte[] 32
$rng.GetBytes($b); $apiKey  = [Convert]::ToBase64String($b) -replace '[+/=]',''
$rng.GetBytes($b); $kioskKey = [Convert]::ToBase64String($b) -replace '[+/=]',''

# 3. Variables de arrivecontrol (produccion)
Set-Location $arriveDir
Write-Output $envs['DATABASE_URL']       | vercel env add DATABASE_URL production
Write-Output $envs['BETTER_AUTH_SECRET'] | vercel env add BETTER_AUTH_SECRET production
Write-Output "https://arrivecontrol.vercel.app"          | vercel env add BETTER_AUTH_URL production
Write-Output "https://arrivecontrol.vercel.app"          | vercel env add BETTER_AUTH_TRUSTED_ORIGINS production
Write-Output "https://gestor-empleados-iota.vercel.app"  | vercel env add GESTOR_URL production
Write-Output $apiKey  | vercel env add INTEGRACION_HORAS_API_KEY production
Write-Output $kioskKey | vercel env add KIOSCO_DEVICE_KEY production

# 4. La misma clave de integracion en el gestor (el endpoint la exige en produccion)
Set-Location $gestorDir
Write-Output $apiKey | vercel env add INTEGRACION_HORAS_API_KEY production

# 5. Desplegar arrivecontrol a produccion
Set-Location $arriveDir
vercel --prod

Write-Host ""
Write-Host "===================================================================="
Write-Host "LISTO. Anota la clave de los kioscos (se pega en la pantalla de"
Write-Host "configuracion del kiosco de cada tablet, campo 'Clave del dispositivo'):"
Write-Host ""
Write-Host "  KIOSCO_DEVICE_KEY = $kioskKey"
Write-Host ""
Write-Host "El gestor necesita un redeploy para tomar INTEGRACION_HORAS_API_KEY:"
Write-Host "se hara solo cuando merges el pull request (o corre 'vercel --prod'"
Write-Host "en la carpeta del gestor)."
Write-Host "===================================================================="
