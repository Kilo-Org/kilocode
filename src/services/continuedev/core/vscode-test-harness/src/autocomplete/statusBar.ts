import * as vscode from "vscode"

import { CONTINUE_WORKSPACE_KEY, getContinueWorkspaceConfig } from "../util/workspaceConfig"

export enum StatusBarStatus {
	Disabled,
	Enabled,
	Paused,
}

const statusBarItemText = (status: StatusBarStatus | undefined, loading?: boolean, error?: boolean) => {
	if (error) {
		return "$(alert) Continue (config error)"
	}

	let text: string
	switch (status) {
		case undefined:
			if (loading) {
				text = "$(loading~spin) Continue"
			} else {
				text = "Continue"
			}
			break
		case StatusBarStatus.Disabled:
			text = "$(circle-slash) Continue"
			break
		case StatusBarStatus.Enabled:
			text = "$(check) Continue"
			break
		case StatusBarStatus.Paused:
			text = "$(debug-pause) Continue"
			break
		default:
			text = "Continue"
	}

	// Append Next Edit indicator if enabled.
	const nextEditEnabled = true //MINIMAL_REPO - was configurable
	if (nextEditEnabled) {
		text += " (NE)"
	}

	return text
}

const statusBarItemTooltip = (status: StatusBarStatus | undefined) => {
	switch (status) {
		case undefined:
		case StatusBarStatus.Disabled:
			return "Click to enable tab autocomplete"
		case StatusBarStatus.Enabled: {
			const nextEditEnabled = true //MINIMAL_REPO - was configurable
			return nextEditEnabled ? "Next Edit is enabled" : "Tab autocomplete is enabled"
		}
		case StatusBarStatus.Paused:
			return "Tab autocomplete is paused"
	}
}

let statusBarStatus: StatusBarStatus | undefined = undefined
let statusBarItem: vscode.StatusBarItem | undefined = undefined
let statusBarFalseTimeout: NodeJS.Timeout | undefined = undefined
let statusBarError: boolean = false

export function stopStatusBarLoading() {
	statusBarFalseTimeout = setTimeout(() => {
		setupStatusBar(StatusBarStatus.Enabled, false)
	}, 100)
}

/**
 * TODO: We should clean up how status bar is handled.
 * Ideally, there should be a single 'status' value without
 * 'loading' and 'error' booleans.
 */
export function setupStatusBar(status: StatusBarStatus | undefined, loading?: boolean, error?: boolean) {
	if (loading !== false) {
		clearTimeout(statusBarFalseTimeout)
		statusBarFalseTimeout = undefined
	}

	// If statusBarItem hasn't been defined yet, create it
	if (!statusBarItem) {
		statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
	}

	if (error !== undefined) {
		statusBarError = error

		if (status === undefined) {
			status = statusBarStatus
		}
	}

	statusBarItem.text = statusBarItemText(status, loading, statusBarError)
	statusBarItem.tooltip = statusBarItemTooltip(status ?? statusBarStatus)
	statusBarItem.command = "continue.openTabAutocompleteConfigMenu"

	statusBarItem.show()
	if (status !== undefined) {
		statusBarStatus = status
	}

	vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration(CONTINUE_WORKSPACE_KEY)) {
			const enabled = getContinueWorkspaceConfig().get<boolean>("enableTabAutocomplete")
			if (enabled && statusBarStatus === StatusBarStatus.Paused) {
				return
			}
			setupStatusBar(enabled ? StatusBarStatus.Enabled : StatusBarStatus.Disabled)
		}
	})
}

export function getStatusBarStatus(): StatusBarStatus | undefined {
	return StatusBarStatus.Enabled
}
