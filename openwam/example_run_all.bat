@echo off
setlocal
rem OpenWAM batch written by wam_export.js: runs each model in its own subfolder, one after another.
rem Keep this file next to the .wam files. Each model NAME gets a folder NAME with NAMEAVG.DAT, NAMEINS.DAT and NAME.log.
set "OPENWAM=C:\Users\<you>\Desktop\openwam2.2-win-x64\openwam2.2-win-x64\Win32_x86_64\OpenWAM2.2-win-x64.exe"
if not exist "%OPENWAM%" (
  echo OpenWAM not found: "%OPENWAM%"
  echo Edit the OPENWAM line at the top of this file.
  pause
  exit /b 1
)
cd /d "%~dp0"
set /a FAILED=0
call :run "i4_41_4000"
call :run "i4_41_6000"
call :run "i4_41_7800"
echo.
if %FAILED%==0 (echo All 3 runs finished correctly.) else (echo %FAILED% run^(s^) did not finish correctly.)
pause
exit /b %FAILED%

:run
if not exist "%~1" mkdir "%~1"
if exist "%~1.wam" copy /y "%~1.wam" "%~1\%~1.wam" >nul
if not exist "%~1\%~1.wam" (
  echo %~1: %~1.wam not found
  set /a FAILED+=1
  exit /b 0
)
pushd "%~1"
echo Running %~1 ...
"%OPENWAM%" "%~1.wam" > "%~1.log" 2>&1
findstr /c:"SIMULATION FINISHED CORRECTLY" "%~1.log" >nul
if errorlevel 1 (
  echo   %~1 did NOT finish correctly, see %~1\%~1.log
  set /a FAILED+=1
) else (
  echo   %~1 finished correctly
)
popd
exit /b 0
