import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { TestRig } from "./test-helper.js"

describe("CLI Logo Display", () => {
	let rig: TestRig

	beforeEach(({ task }) => {
		rig = new TestRig(task.name)
	})

	afterEach(async () => {
		await rig.cleanup()
	})

	it("should display the logo on startup with valid config", async () => {
		const run = await rig.runInteractive([])
		expect(run.getStrippedOutput()).toContain("⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶")
		await run.sendCtrlC()
	})

	it("should not display the logo with --nosplash", async () => {
		const run = await rig.runInteractive(["--nosplash"])
		expect(run.getStrippedOutput()).not.toContain("⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶⣶")
		await run.sendCtrlC()
	})
})
