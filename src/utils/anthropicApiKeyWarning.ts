// kilocode_change - new file
import * as vscode from "vscode"

/**
 * Check for potential ANTHROPIC_API_KEY conflicts with Claude Code provider.
 * Shows a warning if the environment variable is set while using Claude Code provider.
 * Fixes issue #2026 - users were getting confused when their env var conflicted with subscription.
 */
export function checkAnthropicApiKeyConflict(): void {
	const anthropicKey = process.env.ANTHROPIC_API_KEY
	if (!anthropicKey) {
		return
	}

	const config = vscode.workspace.getConfiguration("kilo-code")
	const provider = config.get<string>("apiProvider")

	if (provider === "claude-code") {
		showAnthropicApiKeyWarning()
	}
}

function showAnthropicApiKeyWarning(): void {
	const msg =
		"An ANTHROPIC_API_KEY environment variable was detected. This may conflict with your subscription login and cause errors. Please unset it to ensure your Claude Max/Pro plan is used."

	vscode.window.showWarningMessage(msg, "More Info", "Got it").then((choice) => {
		if (choice === "More Info") {
			vscode.env.openExternal(vscode.Uri.parse("https://github.com/Kilo-Org/kilocode/issues/2026"))
		}
		// User dismissed or clicked "Got it" - nothing else to do
	})
}
