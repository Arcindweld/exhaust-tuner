# Diagnostic for the Windows OpenFOAM build: the incompressible square-cut-pipe case, meshed once, then each variant
# from make_variants.py run for 3 iterations with fields written every iteration (17 digits). Prints every residual
# line so the run can be compared with the same variants on Linux.
#   pwsh windows_variants.ps1 -OF C:\ET\OpenFOAM-v2412 -Repo <checkout> -Out <folder>
param([Parameter(Mandatory)][string]$OF, [Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = "Stop"
$env:WM_PROJECT = "OpenFOAM"; $env:WM_PROJECT_VERSION = "v2412"; $env:WM_PROJECT_DIR = $OF
$env:PATH = "$OF\bin;$env:PATH"
$env:INTAKE_CFD_STAMP = "probe"
New-Item -ItemType Directory -Force $Out | Out-Null
$mesh = Join-Path $Out "mesh"
python "$Repo\cfd\intake_cfd.py" "$Repo\cfd\tests\pp_inc.json" $mesh | Out-Null
Push-Location $mesh
blockMesh *> log.blockMesh; if ($LASTEXITCODE) { throw "blockMesh failed" }
topoSet *> log.topoSet; if ($LASTEXITCODE) { throw "topoSet failed" }
Pop-Location
python "$Repo\cfd\validation\diag\make_variants.py" $mesh (Join-Path $Out "var") 3
foreach ($d in Get-ChildItem (Join-Path $Out "var") -Directory) {
  Push-Location $d.FullName
  simpleFoam *> log.simpleFoam
  "== $($d.Name) exit $LASTEXITCODE"
  Select-String -Path log.simpleFoam -Pattern "^Time = |Solving for|^Build" | ForEach-Object { $_.Line }
  Pop-Location
}
# geometry and gradients from the (identical) iteration-1 fields of the laminar variant
Push-Location (Join-Path $Out "var\laminar")
postProcess -time 1 -func writeCellCentres *> log.pp_cc
postProcess -time 1 -func writeCellVolumes *> log.pp_v
postProcess -time 1 -func "grad(U)" *> log.pp_gradU
postProcess -time 1 -func "grad(p)" *> log.pp_gradp
"postProcess exit codes written; files in 1/: " + ((Get-ChildItem 1 -File | ForEach-Object { $_.Name }) -join " ")
Pop-Location
