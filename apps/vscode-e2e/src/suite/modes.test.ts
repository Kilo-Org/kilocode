import * as assert from "assert"

import { RooCodeEventName } from "@roo-code/types"

import { waitUntilCompleted } from "./utils"
import { setDefaultSuiteTimeout } from "./test-utils"

suite("Kilo Code Modes", function () {
	setDefaultSuiteTimeout(this)

	test("Should handle switching modes correctly", async () => {
		const modes: string[] = []

		globalThis.api.on(RooCodeEventName.TaskModeSwitched, (_taskId, mode) => modes.push(mode))

		const switchModesTaskId = await globalThis.api.startNewTask({
			configuration: { mode: "code", alwaysAllowModeSwitch: true, autoApprovalEnabled: true },
			text: "Use the `switch_mode` tool to switch to ask mode.",
		})

		await waitUntilCompleted({ api: globalThis.api, taskId: switchModesTaskId })
		await globalThis.api.cancelCurrentTask()

		assert.ok(modes.includes("ask"))
		assert.ok(modes.length === 1)
	})
})
