// kilocode_change - new file

import * as vscode from "vscode"
import type { ClineProvider } from "../../core/webview/ClineProvider"
import type { ContextConfigChange, ContextConfigType } from "@roo-code/types"
import { t } from "../../i18n"

interface ConfigInput {
	name: string
	source: "global" | "project"
	mode?: string
	path?: string
}

export class ConfigChangeNotifier {
	private providerRef: WeakRef<ClineProvider>
	private previousKeys = new Map<ContextConfigType, Set<string>>()

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
	}

	async notifyIfChanged(configType: ContextConfigType, currentConfigs: ConfigInput[]): Promise<void> {
		const currentKeys = new Set(currentConfigs.map((c) => `${c.source}:${c.mode || ""}:${c.name}`))

		if (!this.previousKeys.has(configType)) {
			this.previousKeys.set(configType, currentKeys)
			return
		}

		const previousKeys = this.previousKeys.get(configType)!
		const changes = this.detectChanges(previousKeys, currentKeys, currentConfigs, configType)

		this.previousKeys.set(configType, currentKeys)

		if (changes.length > 0) {
			await this.showNotifications(changes)
		}
	}

	private detectChanges(
		previousKeys: Set<string>,
		currentKeys: Set<string>,
		currentConfigs: ConfigInput[],
		configType: ContextConfigType,
	): ContextConfigChange[] {
		const changes: ContextConfigChange[] = []
		const configsByKey = new Map(currentConfigs.map((c) => [`${c.source}:${c.mode || ""}:${c.name}`, c]))

		for (const key of currentKeys) {
			if (!previousKeys.has(key)) {
				const config = configsByKey.get(key)!
				changes.push({
					configType,
					changeType: "added",
					name: config.name,
					source: config.source,
					mode: config.mode,
					filePath: config.path,
				})
			}
		}

		for (const key of previousKeys) {
			if (!currentKeys.has(key)) {
				const parts = key.split(":")
				changes.push({
					configType,
					changeType: "removed",
					name: parts.slice(2).join(":"),
					source: parts[0] as "global" | "project",
					mode: parts[1] || undefined,
				})
			}
		}

		return changes
	}

	private async showNotifications(changes: ContextConfigChange[]): Promise<void> {
		const provider = this.providerRef.deref()
		if (!provider) return

		for (const change of changes) {
			vscode.window.showInformationMessage(this.formatMessage(change))
		}
	}

	private formatMessage(change: ContextConfigChange): string {
		const modeStr = change.mode ? ` (${change.mode} mode)` : ""
		const sourceStr = change.source === "global" ? "global" : "project"
		const key =
			change.changeType === "added" ? "kilocode:configDiscovery.added" : "kilocode:configDiscovery.removed"
		return t(key, { configType: change.configType, name: change.name, source: sourceStr, modeStr })
	}
}
