import * as vscode from "vscode"

import { Package } from "../shared/package"
import { ClineProvider } from "../core/webview/ClineProvider"
import { t } from "../i18n"

export const handleNewTask = async (
	// kilocode_change start: Add profile and mode switching support
	params: { prompt?: string; profile?: string; mode?: string } | null | undefined,
) => {
	let prompt = params?.prompt

	if (!prompt) {
		prompt = await vscode.window.showInputBox({
			prompt: t("common:input.task_prompt"),
			placeHolder: t("common:input.task_placeholder"),
		})
	}

	if (!prompt) {
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		return
	}

	// kilocode_change start: Handle profile and mode switching if provided
	if (params?.profile || params?.mode) {
		try {
			const visibleProvider = await ClineProvider.getInstance()
			if (params.profile) {
				await visibleProvider?.activateProviderProfile({ name: params.profile })
			}
			if (params.mode) {
				await visibleProvider?.setMode(params.mode)
			}
		} catch (error) {
			console.error(`Failed to switch profile/mode:`, error)
			return
		}
	}
	// kilocode_change end: Add profile and mode switching support

	await ClineProvider.handleCodeAction("newTask", "NEW_TASK", { userInput: prompt })
}
