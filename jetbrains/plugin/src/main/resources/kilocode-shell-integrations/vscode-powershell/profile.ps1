# ---------------------------------------------------------------------------------------------
#   Copyright (c) Microsoft Corporation. All rights reserved.
#   Licensed under the MIT License. See License.txt in the project root for license information.
# ---------------------------------------------------------------------------------------------

# Add debug output
if ($env:WECODER_SHELL_INTEGRATION -eq "1") {
	Write-Host "🚀 WeCoder PowerShell Shell Integration Loading..." -ForegroundColor Green
	Write-Host "📁 Script Path: $($env:WECODER_SCRIPT_PATH)" -ForegroundColor Yellow
	Write-Host "🔑 Nonce: $($env:VSCODE_NONCE)" -ForegroundColor Yellow
}

# Prevent installing more than once per session
if (Test-Path variable:global:__VSCodeOriginalPrompt) {
	if ($env:WECODER_SHELL_INTEGRATION -eq "1") {
		Write-Host "⚠️ Shell integration already loaded, skipping..." -ForegroundColor Yellow
	}
	return;
}

# Disable shell integration when the language mode is restricted
if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") {
	if ($env:WECODER_SHELL_INTEGRATION -eq "1") {
		Write-Host "❌ Shell integration disabled due to restricted language mode" -ForegroundColor Red
		# Automatically run diagnostic script
		$diagnosePath = Join-Path (Split-Path $env:WECODER_SCRIPT_PATH -Parent) "diagnose.ps1"
		if (Test-Path $diagnosePath) {
			Write-Host "🔍 Running diagnostic script..." -ForegroundColor Yellow
			& $diagnosePath
		}
	}
	return;
}

# Load user's original PowerShell profile if shell integration was injected
if ($env:VSCODE_INJECTION -eq "1") {
	# Source user's original profile if it exists
	$UserProfile = $PROFILE.CurrentUserCurrentHost
	if (Test-Path $UserProfile) {
		. $UserProfile
	}
	$env:VSCODE_INJECTION = $null
}

$Global:__VSCodeOriginalPrompt = $function:Prompt
$Global:__LastHistoryId = -1
$Global:__VSCodeIsInExecution = $false

# Store the nonce in script scope and unset the global
$Nonce = $env:VSCODE_NONCE
$env:VSCODE_NONCE = $null

$__vscode_shell_env_reporting = $env:VSCODE_SHELL_ENV_REPORTING
$env:VSCODE_SHELL_ENV_REPORTING = $null

function Global:__VSCode-Escape-Value([string]$value) {
	# Replace any non-alphanumeric characters.
	[regex]::Replace($value, "[$([char]0x00)-$([char]0x1f)\\\n;]", { param($match)
		# Encode the (ascii) matches as `\x<hex>`
		-Join (
			[System.Text.Encoding]::UTF8.GetBytes($match.Value) | ForEach-Object { '\x{0:x2}' -f $_ }
		)
	})
}

function Global:Prompt() {
	$FakeCode = [int]!$global:?
	Set-StrictMode -Off
	$LastHistoryEntry = Get-History -Count 1
	$Result = ""
	
	# Define escape sequences
	$esc = [char]0x1b
	$bell = [char]0x07
	
	# Skip finishing the command if the first command has not yet started or an execution has not yet begun
	if ($Global:__LastHistoryId -ne -1 -and $Global:__VSCodeIsInExecution -eq $true) {
		$Global:__VSCodeIsInExecution = $false
		if ($LastHistoryEntry.Id -eq $Global:__LastHistoryId) {
			# Don't provide a command line or exit code if there was no history entry (eg. ctrl+c, enter on no command)
			$Result += $esc + ']633;D' + $bell
		} else {
			# Command finished exit code
			$Result += $esc + ']633;D;' + $FakeCode + $bell
		}
	}

	# Prompt started
	$Result += $esc + ']633;A' + $bell

	# Current working directory
	if ($pwd.Provider.Name -eq 'FileSystem') {
		$cwdEscaped = __VSCode-Escape-Value $pwd.ProviderPath
		$Result += $esc + ']633;P;Cwd=' + $cwdEscaped + $bell
	}

	# Before running the original prompt, put $? back to what it was:
	if ($FakeCode -ne 0) {
		Write-Error "failure" -ea ignore
	}

	# Run the original prompt
	$OriginalPrompt = $Global:__VSCodeOriginalPrompt.Invoke()
	$Result += $OriginalPrompt

	# Write command started
	$Result += "${esc}]633;B${bell}"
	$Global:__LastHistoryId = $LastHistoryEntry.Id
	return $Result
}

# Define escape sequences for console output
$esc = [char]0x1b
$bell = [char]0x07

# Report shell information
$shellSeq = "${esc}]633;P;Shell=powershell${bell}"
[Console]::Write($shellSeq)

# Set IsWindows property
if ($PSVersionTable.PSVersion -lt "6.0") {
	# Windows PowerShell is only available on Windows
	$winSeq = "${esc}]633;P;IsWindows=`$true${bell}"
	[Console]::Write($winSeq)
} else {
	$winSeq = "${esc}]633;P;IsWindows=`$IsWindows${bell}"
	[Console]::Write($winSeq)
}

# Only send the command executed sequence when PSReadLine is loaded
if (Get-Module -Name PSReadLine) {
	$richSeq = "${esc}]633;P;HasRichCommandDetection=True${bell}"
	[Console]::Write($richSeq)

	$__VSCodeOriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine
	function Global:PSConsoleHostReadLine {
		$CommandLine = $__VSCodeOriginalPSConsoleHostReadLine.Invoke()
		$Global:__VSCodeIsInExecution = $true

		# Command line
		$Result = $esc + ']633;E;' + $(__VSCode-Escape-Value $CommandLine) + ';' + $Nonce + $bell

		# Command executed
		$Result += $esc + ']633;C' + $bell

		# Write command executed sequence directly to Console
		[Console]::Write($Result)

		$CommandLine
	}
}

# Add confirmation message for successful loading
if ($env:WECODER_SHELL_INTEGRATION -eq "1") {
	# Check if shell integration is correctly initialized
	$shellIntegrationOk = $true
	
	# Check if required variables exist
	if (-not $Nonce) {
		Write-Host "⚠️ Warning: VSCODE_NONCE is not set correctly" -ForegroundColor Yellow
		$shellIntegrationOk = $false
	}
	
	# Check if Prompt function is correctly defined
	if (-not (Test-Path function:Global:Prompt)) {
		Write-Host "⚠️ Warning: Global:Prompt function is not correctly defined" -ForegroundColor Yellow
		$shellIntegrationOk = $false
	}
	
	# Check PSReadLine
	if (-not (Get-Module -Name PSReadLine)) {
		Write-Host "⚠️ Warning: PSReadLine module is not loaded, some features may be unavailable" -ForegroundColor Yellow
	}
	
	if ($shellIntegrationOk) {
		Write-Host "✅ WeCoder PowerShell Shell Integration loaded successfully!" -ForegroundColor Green
	} else {
		Write-Host "❌ WeCoder PowerShell Shell Integration encountered issues during loading" -ForegroundColor Red
		# Automatically run diagnostic script
		$diagnosePath = Join-Path (Split-Path $env:WECODER_SCRIPT_PATH -Parent) "diagnose.ps1"
		if (Test-Path $diagnosePath) {
			Write-Host "🔍 Automatically running diagnostic script..." -ForegroundColor Yellow
			& $diagnosePath
		}
	}
	
	# Clean up debug environment variables
	$env:WECODER_SHELL_INTEGRATION = $null
	$env:WECODER_SCRIPT_PATH = $null
} 