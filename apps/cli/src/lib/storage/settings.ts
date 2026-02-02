import fs from "fs/promises"
import path from "path"

import type { CliSettings } from "@/types/index.js"

import { getConfigDir } from "./index.js"

export function getSettingsPath(): string {
	return path.join(getConfigDir(), "cli-settings.json")
}

export async function loadSettings(): Promise<CliSettings> {
	try {
		const settingsPath = getSettingsPath()
		const data = await fs.readFile(settingsPath, "utf-8")
		return JSON.parse(data) as CliSettings
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {}
		}

		throw error
	}
}

export async function saveSettings(settings: Partial<CliSettings>): Promise<void> {
	const configDir = getConfigDir()
	await fs.mkdir(configDir, { recursive: true })

	const existing = await loadSettings()
	const merged = { ...existing, ...settings }

	await fs.writeFile(getSettingsPath(), JSON.stringify(merged, null, 2), {
		mode: 0o600,
	})
}

export async function resetOnboarding(): Promise<void> {
	await saveSettings({ onboardingProviderChoice: undefined })
}
