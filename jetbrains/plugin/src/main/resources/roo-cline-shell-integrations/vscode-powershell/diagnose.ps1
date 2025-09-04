# SPDX-FileCopyrightText: 2025 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

# WeCoder PowerShell Shell Integration Diagnostic Script
# This script is used to diagnose shell integration issues

Write-Host "WeCoder PowerShell Shell Integration Diagnostic Tool" -ForegroundColor Blue
Write-Host "================================================" -ForegroundColor Blue

# Check PowerShell version
Write-Host "PowerShell Version: $($PSVersionTable.PSVersion)" -ForegroundColor Green

# Check execution policy
Write-Host "Execution Policy: $(Get-ExecutionPolicy)" -ForegroundColor Yellow

# Check language mode
Write-Host "Language Mode: $($ExecutionContext.SessionState.LanguageMode)" -ForegroundColor Green

# Check PSReadLine module
$psReadLineModule = Get-Module -Name PSReadLine
if ($psReadLineModule) {
    Write-Host "PSReadLine Module: Loaded (Version: $($psReadLineModule.Version))" -ForegroundColor Green
} else {
    Write-Host "PSReadLine Module: Not loaded" -ForegroundColor Red
}

# Check environment variables
Write-Host "Related Environment Variables:" -ForegroundColor Cyan
$envVars = @('VSCODE_NONCE', 'VSCODE_INJECTION', 'VSCODE_SHELL_ENV_REPORTING', 'WECODER_SHELL_INTEGRATION', 'WECODER_SCRIPT_PATH')
foreach ($var in $envVars) {
    $value = [Environment]::GetEnvironmentVariable($var)
    if ($value) {
        Write-Host "  $var = $value" -ForegroundColor White
    } else {
        Write-Host "  $var = (Not set)" -ForegroundColor Gray
    }
}

# Check shell integration status
if (Test-Path variable:global:__VSCodeOriginalPrompt) {
    Write-Host "Shell Integration: Initialized" -ForegroundColor Green
} else {
    Write-Host "Shell Integration: Not initialized" -ForegroundColor Red
}

# Test shell integration sequences
Write-Host "Testing shell integration initialization sequence..." -ForegroundColor Yellow
$esc = [char]27
$bell = [char]7
$seq1 = $esc + ']633;P;Shell=powershell' + $bell
$seq2 = $esc + ']633;A' + $bell
[Console]::Write($seq1)
[Console]::Write($seq2)
Write-Host "Initialization sequence sent" -ForegroundColor Green

Write-Host "================================================" -ForegroundColor Blue
Write-Host "Diagnosis complete. If issues persist, check if terminal supports VSCode shell integration sequences." -ForegroundColor Blue 