// Test screenshot action functionality in browser actions
import { describe, it, expect } from "vitest"
import { browserActions } from "../../../shared/ExtensionMessage"

describe("Browser Action Screenshot", () => {
	describe("browserActions array", () => {
		it("should include screenshot action", () => {
			expect(browserActions).toContain("screenshot")
		})

		it("should have screenshot as a valid browser action type", () => {
			const allActions = [
				"launch",
				"click",
				"hover",
				"type",
				"press",
				"scroll_down",
				"scroll_up",
				"resize",
				"close",
				"screenshot",
			]
			expect(browserActions).toEqual(allActions)
		})
	})
})
