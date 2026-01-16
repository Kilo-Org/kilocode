// kilocode_change - new file

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ClineProvider } from "../../core/webview/ClineProvider"
import { ConfigChangeNotifier } from "./ConfigChangeNotifier"

const { mockShowInformationMessage } = vi.hoisted(() => ({
	mockShowInformationMessage: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: { showInformationMessage: mockShowInformationMessage },
}))

vi.mock("../../i18n", () => ({
	t: vi.fn((key, vars) => `${key} ${JSON.stringify(vars)}`),
}))

describe("ConfigChangeNotifier", () => {
	let mockProvider: ClineProvider
	let notifier: ConfigChangeNotifier

	beforeEach(() => {
		vi.clearAllMocks()
		mockProvider = { cwd: "/test" } as unknown as ClineProvider
		notifier = new ConfigChangeNotifier(mockProvider)
	})

	it("should skip initial discovery without notifying", async () => {
		await notifier.notifyIfChanged("skill", [{ name: "test-skill", source: "global" }])
		expect(mockShowInformationMessage).not.toHaveBeenCalled()
	})

	it("should detect added configurations", async () => {
		await notifier.notifyIfChanged("skill", [{ name: "existing-skill", source: "global" }])
		await notifier.notifyIfChanged("skill", [
			{ name: "existing-skill", source: "global" },
			{ name: "new-skill", source: "global" },
		])
		expect(mockShowInformationMessage).toHaveBeenCalledTimes(1)
		expect(mockShowInformationMessage).toHaveBeenCalledWith(expect.stringContaining("new-skill"))
	})

	it("should detect removed configurations", async () => {
		await notifier.notifyIfChanged("skill", [
			{ name: "existing-skill", source: "global" },
			{ name: "removed-skill", source: "global" },
		])
		await notifier.notifyIfChanged("skill", [{ name: "existing-skill", source: "global" }])
		expect(mockShowInformationMessage).toHaveBeenCalledTimes(1)
		expect(mockShowInformationMessage).toHaveBeenCalledWith(expect.stringContaining("removed-skill"))
	})

	it("should track different config types separately", async () => {
		await notifier.notifyIfChanged("skill", [{ name: "skill-a", source: "global" }])
		await notifier.notifyIfChanged("workflow", [{ name: "workflow-a", source: "global" }])
		await notifier.notifyIfChanged("skill", [
			{ name: "skill-a", source: "global" },
			{ name: "skill-b", source: "global" },
		])
		expect(mockShowInformationMessage).toHaveBeenCalledTimes(1)
		expect(mockShowInformationMessage).toHaveBeenCalledWith(expect.stringContaining("skill-b"))
	})
})
