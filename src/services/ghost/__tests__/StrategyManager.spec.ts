import { describe, it, expect } from "vitest"
import { createStrategyInstance } from "../StrategyManager"
import { GhostXmlStrategy } from "../GhostXmlStrategy"

describe("createStrategyInstance", () => {
	it("should create strategy instances correctly", () => {
		// Test valid strategy creation
		const validStrategy = createStrategyInstance("xml-default")
		expect(validStrategy).toBeInstanceOf(GhostXmlStrategy)

		// Test fallback for invalid strategy
		const invalidStrategy = createStrategyInstance("non-existent")
		expect(invalidStrategy).toBeInstanceOf(GhostXmlStrategy)
	})
})
