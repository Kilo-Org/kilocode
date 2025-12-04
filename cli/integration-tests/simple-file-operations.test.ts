import { beforeEach, afterEach, it, expect } from "vitest"
import { describe } from "vitest"
import { poll, TestRig } from "./test-helper"
import { onTestFailed } from "vitest"

describe("Simple File Operations", () => {
	let rig: TestRig

	beforeEach(({ task }) => {
		rig = new TestRig(task.name)
	})

	afterEach(async () => {
		await rig.cleanup()
	})

	it("should increase a file number in an existing file", async () => {
		rig.createFile("text.json", JSON.stringify({ version: 1 }))

		const run = await rig.runInteractive(["--mode", "code"])

		onTestFailed(() => {
			console.log(run.getStrippedOutput())
		})
		await run.type("Increase the version number in text.json with 1")

		await run.pressEnter()

		await poll(
			() => {
				return (
					run.getStrippedOutput().includes("✓ Task Completed") || run.getStrippedOutput().includes("✖ Error")
				)
			},
			60_000,
			1_000,
		)

		expect(rig.readFile("text.json")).toEqual(JSON.stringify({ version: 2 }))
	}, 120_000)
})
