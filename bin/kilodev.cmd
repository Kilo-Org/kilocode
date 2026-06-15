@echo off
setlocal enabledelayedexpansion
set "dir=%~dp0.."
set "KILO_DEV_REPO=%dir%"
rem Find the first non-flag arg. If there isn't one, the user is launching the
rem TUI, so point it at the caller's directory via --project. Otherwise
rem forward untouched so subcommands don't collide with --project.
set "first="
for %%a in (%*) do (
  if not defined first (
    set "arg=%%~a"
    if "!arg:~0,1!" neq "-" set "first=%%~a"
  )
)
if not defined first (
  bun run --cwd "%dir%\packages\opencode" --conditions=browser src/index.ts --project "%CD%" %*
) else (
  bun run --cwd "%dir%\packages\opencode" --conditions=browser src/index.ts %*
)
set "code=%ERRORLEVEL%"
endlocal & exit /b %code%
