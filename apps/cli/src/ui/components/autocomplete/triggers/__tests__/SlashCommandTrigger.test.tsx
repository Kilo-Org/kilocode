import { type SlashCommandResult, createSlashCommandTrigger, toSlashCommandResult } from "../SlashCommandTrigger.js"

describe("SlashCommandTrigger", () => {
	describe("toSlashCommandResult", () => {
		it("should convert command to SlashCommandResult with key", () => {
			const input = {
				name: "test",
				description: "A test command",
				source: "built-in" as const,
			}
			const result = toSlashCommandResult(input)

			expect(result).toEqual({
				key: "test",
				name: "test",
				description: "A test command",
				argumentHint: undefined,
				source: "built-in",
			})
		})

		it("should include argumentHint if provided", () => {
			const input = {
				name: "mode",
				description: "Switch mode",
				argumentHint: "<mode-name>",
				source: "project" as const,
			}
			const result = toSlashCommandResult(input)

			expect(result).toEqual({
				key: "mode",
				name: "mode",
				description: "Switch mode",
				argumentHint: "<mode-name>",
				source: "project",
			})
		})
	})

	describe("detectTrigger", () => {
		const getCommands = (): SlashCommandResult[] => []
		const trigger = createSlashCommandTrigger({ getCommands })

		it("should detect / at line start", () => {
			const result = trigger.detectTrigger("/test")

			expect(result).toEqual({
				query: "test",
				triggerIndex: 0,
			})
		})

		it("should detect / with leading whitespace", () => {
			const result = trigger.detectTrigger("  /test")

			expect(result).toEqual({
				query: "test",
				triggerIndex: 2,
			})
		})

		it("should return query with empty string for just /", () => {
			const result = trigger.detectTrigger("/")

			expect(result).toEqual({
				query: "",
				triggerIndex: 0,
			})
		})

		it("should return null when / not at line start", () => {
			const result = trigger.detectTrigger("hello /test")

			expect(result).toBeNull()
		})

		it("should return null when query contains space", () => {
			const result = trigger.detectTrigger("/test command")

			expect(result).toBeNull()
		})
	})

	describe("getReplacementText", () => {
		const getCommands = (): SlashCommandResult[] => []
		const trigger = createSlashCommandTrigger({ getCommands })

		it("should replace / trigger with command name", () => {
			const item: SlashCommandResult = {
				key: "test",
				name: "test",
				source: "built-in",
			}
			const result = trigger.getReplacementText(item, "/tes", 0)

			expect(result).toBe("/test ")
		})

		it("should preserve leading whitespace", () => {
			const item: SlashCommandResult = {
				key: "mode",
				name: "mode",
				source: "project",
			}
			const result = trigger.getReplacementText(item, "  /mo", 2)

			expect(result).toBe("  /mode ")
		})
	})

	describe("search", () => {
		it("should return all commands when query is empty", async () => {
			const mockCommands: SlashCommandResult[] = [
				{ key: "test", name: "test", source: "built-in" },
				{ key: "mode", name: "mode", source: "project" },
			]
			const getCommands = vi.fn(() => mockCommands)
			const trigger = createSlashCommandTrigger({ getCommands })

			const result = await trigger.search("")

			expect(result).toEqual(mockCommands)
		})

		it("should fuzzy search commands by name", async () => {
			const mockCommands: SlashCommandResult[] = [
				{ key: "test", name: "test", source: "built-in" },
				{ key: "mode", name: "mode", source: "project" },
				{ key: "help", name: "help", source: "built-in" },
			]
			const getCommands = vi.fn(() => mockCommands)
			const trigger = createSlashCommandTrigger({ getCommands })

			const result = await trigger.search("mod")

			// Should prioritize "mode" since it matches best
			expect(result.length).toBeGreaterThan(0)
			expect(result[0]?.name).toBe("mode")
		})

		it("should respect maxResults option", async () => {
			const mockCommands: SlashCommandResult[] = Array.from({ length: 30 }, (_, i) => ({
				key: `cmd${i}`,
				name: `cmd${i}`,
				source: "built-in" as const,
			}))
			const getCommands = vi.fn(() => mockCommands)
			const trigger = createSlashCommandTrigger({ getCommands, maxResults: 5 })

			const result = await trigger.search("")

			expect(result).toHaveLength(5)
		})
	})
})
