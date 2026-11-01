# Runs the Blair & Cahoon square-cut-pipe case (compressible and incompressible) with our Windows OpenFOAM
# build and compares every plane against the Linux runs of the same cases (cfd/validation/reference): same mesh,
# same 6000 iterations, converged, same generator version and numerics (compare_results.py refuses a reference made
# another way). The Linux runs that stop when settled (cfd/validation/reference/*_medium_linux_results.json, 1870 and
# 2620 iterations) are within 0.02 % of the 6000-iteration runs at the tract end and within 0.32 % everywhere (the
# total pressure 2 D into the outlet extension settles last), so the comparison is made at 6000 iterations on both
# sides; our build lands within 0.021 % (compressible) and 0.051 % (incompressible) of Linux, ESI's Ubuntu package
# within 0.016 % and 0.051 % (generator 1.1.0).
#   pwsh validate_windows.ps1 -OF C:\ET\OpenFOAM-v2412 -Repo <checkout>
param([Parameter(Mandatory)][string]$OF, [Parameter(Mandatory)][string]$Repo)
$ErrorActionPreference = "Stop"
$env:WM_PROJECT = "OpenFOAM"; $env:WM_PROJECT_VERSION = "v2412"; $env:WM_PROJECT_DIR = $OF
$env:PATH = "$OF\bin;$env:PATH"
$env:INTAKE_CFD_STAMP = "probe"
$tmp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$fails = 0
foreach ($c in @(@{json="pp.json"; ref="pp_medium_linux_6000it_results.json"}, @{json="pp_inc.json"; ref="pp_inc_medium_linux_6000it_results.json"})) {
  $name = [IO.Path]::GetFileNameWithoutExtension($c.json)
  $dir = Join-Path $tmp "case_$name"
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  python "$Repo\cfd\intake_cfd.py" "$Repo\cfd\tests\$($c.json)" $dir | Out-Null
  Push-Location $dir
  $solver = (Select-String -Path system/controlDict -Pattern '^application\s+(\S+);').Matches[0].Groups[1].Value
  foreach ($exe in "blockMesh", "checkMesh", "topoSet", $solver) {
    $t0 = Get-Date
    & $exe *> "log.$exe"
    $rc = $LASTEXITCODE
    "{0,-8} {1,-14} exit {2}  {3,6:N0} s" -f $name, $exe, $rc, ((Get-Date) - $t0).TotalSeconds
    if ($rc -ne 0) { Get-Content "log.$exe" -Tail 30; Pop-Location; throw "$exe failed on $name" }
  }
  Select-String -Path "log.$solver" -Pattern "^Build|^Time = 6000$" | Select-Object -First 2 | ForEach-Object { $_.Line }
  python intake_report.py | Select-Object -Last 6
  Pop-Location
  python "$Repo\tools\openfoam\compare_results.py" "$dir\results.json" "$Repo\cfd\validation\reference\$($c.ref)" 0.002
  if ($LASTEXITCODE -ne 0) { $fails++ }
}
if ($fails) { throw "$fails case(s) differ from the Linux reference" }
"Windows build reproduces the Linux reference on both cases."
