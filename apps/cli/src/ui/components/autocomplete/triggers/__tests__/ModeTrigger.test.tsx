import { type ModeResult, createModeTrigger, toModeResult } from "../ModeTrigger.js"

describe("ModeTrigger", () => {
	const testModes: ModeResult[] = [
		{ key: "code", slug: "code", name: "Code", description: "Write and modify code" },
		{ key: "architect", slug: "architect", name: "Architect", description: "Plan and design" },
		{ key: "debug", slug: "debug", name: "Debug", description: "Troubleshoot issues" },
		{ key: "ask", slug: "ask", name: "Ask", description: "Get explanations" },
	]

	describe("createModeTrigger", () => {
		it("should create a trigger with correct configuration", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			expect(trigger.id).toBe("mode")
			expect(trigger.triggerChar).toBe("!")
			expect(trigger.position).toBe("line-start")
			expect(trigger.emptyMessage).toBe("No matching modes found")
			expect(trigger.debounceMs).toBe(150)
		})

		it("should detect trigger at line start", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const result = trigger.detectTrigger("!code")

			expect(result).not.toBeNull()
			expect(result?.query).toBe("code")
			expect(result?.triggerIndex).toBe(0)
		})

		it("should detect trigger after whitespace", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const result = trigger.detectTrigger("  !architect")

			expect(result).not.toBeNull()
			expect(result?.query).toBe("architect")
			expect(result?.triggerIndex).toBe(2)
		})

		it("should not detect trigger in middle of text", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const result = trigger.detectTrigger("some text !code")

			expect(result).toBeNull()
		})

		it("should close picker when query contains space", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const result = trigger.detectTrigger("!code something")

			expect(result).toBeNull()
		})

		it("should return all modes when query is empty", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const results = trigger.search("")

			expect(results).toEqual(testModes)
		})

		it("should filter modes by name using fuzzy search", async () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const results = await trigger.search("deb")

			expect(results).toHaveLength(1)
			expect(results[0]!.slug).toBe("debug")
		})

		it("should filter modes by slug using fuzzy search", async () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const results = await trigger.search("arch")

			expect(results).toHaveLength(1)
			expect(results[0]!.slug).toBe("architect")
		})

		it("should respect maxResults limit", async () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
				maxResults: 2,
			})

			const results = await trigger.search("")

			expect(results.length).toBeLessThanOrEqual(2)
		})

		it("should return empty replacement text", () => {
			const trigger = createModeTrigger({
				getModes: () => testModes,
			})

			const mode = testModes[0]!
			const replacement = trigger.getReplacementText(mode, "!code", 0)

			expect(replacement).toBe("")
		})
	})

	describe("toModeResult", () => {
		it("should convert mode data to ModeResult", () => {
			const modeData = {
				slug: "code",
				name: "Code",
				description: "Write and modify code",
				icon: "💻",
			}

			const result = toModeResult(modeData)

			expect(result).toEqual({
				key: "code",
				slug: "code",
				name: "Code",
				description: "Write and modify code",
				icon: "💻",
			})
		})

		it("should handle mode without description", () => {
			const modeData = {
				slug: "test",
				name: "Test Mode",
			}

			const result = toModeResult(modeData)

			expect(result).toEqual({
				key: "test",
				slug: "test",
				name: "Test Mode",
				description: undefined,
				icon: undefined,
			})
		})
	})
})
