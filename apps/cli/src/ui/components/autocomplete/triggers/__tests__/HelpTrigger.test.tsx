import { render } from "ink-testing-library"

import { createHelpTrigger, type HelpShortcutResult } from "../HelpTrigger.js"

describe("HelpTrigger", () => {
	describe("createHelpTrigger", () => {
		it("should detect ? trigger at line start", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("?")
			expect(result).toEqual({ query: "", triggerIndex: 0 })
		})

		it("should detect ? trigger with query", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("?slash")
			expect(result).toEqual({ query: "slash", triggerIndex: 0 })
		})

		it("should detect ? trigger after whitespace", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("  ?")
			expect(result).toEqual({ query: "", triggerIndex: 2 })
		})

		it("should not detect ? in middle of text", () => {
			const trigger = createHelpTrigger()

			// The trigger position is "line-start", so it should only match at start
			const result = trigger.detectTrigger("some text ?")
			expect(result).toBeNull()
		})

		it("should not detect ? followed by space", () => {
			const trigger = createHelpTrigger()

			const result = trigger.detectTrigger("? ")
			expect(result).toBeNull()
		})

		it("should return all shortcuts when query is empty", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("") as HelpShortcutResult[]
			expect(results.length).toBe(9)
			expect(results.map((r) => r.shortcut)).toContain("/")
			expect(results.map((r) => r.shortcut)).toContain("@")
			expect(results.map((r) => r.shortcut)).toContain("!")
			expect(results.map((r) => r.shortcut)).toContain("#")
			expect(results.map((r) => r.shortcut)).toContain("shift + ⏎")
			expect(results.map((r) => r.shortcut)).toContain("tab")
			expect(results.map((r) => r.shortcut)).toContain("ctrl + m")
			expect(results.map((r) => r.shortcut)).toContain("ctrl + c")
			expect(results.map((r) => r.shortcut)).toContain("ctrl + t")
		})

		it("should include ctrl+t shortcut for TODO list", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("todo") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("ctrl + t")
			expect(results[0]?.description).toContain("TODO")
		})

		it("should clear input for todos action shortcut", () => {
			const trigger = createHelpTrigger()

			const todosItem: HelpShortcutResult = {
				key: "todos",
				shortcut: "ctrl + t",
				description: "to view TODO list",
			}
			const replacement = trigger.getReplacementText(todosItem, "?todo", 0)
			expect(replacement).toBe("")
		})

		it("should filter shortcuts by shortcut character", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("/") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("/")
		})

		it("should filter shortcuts by description", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("file") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("@")
			expect(results[0]?.description).toContain("file")
		})

		it("should filter case-insensitively", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("QUIT") as HelpShortcutResult[]
			expect(results.length).toBe(1)
			expect(results[0]?.shortcut).toBe("ctrl + c")
		})

		it("should return empty array for non-matching query", () => {
			const trigger = createHelpTrigger()

			const results = trigger.search("xyz") as HelpShortcutResult[]
			expect(results.length).toBe(0)
		})

		it("should generate replacement text for trigger shortcuts", () => {
			const trigger = createHelpTrigger()

			const slashItem: HelpShortcutResult = { key: "slash", shortcut: "/", description: "for commands" }
			const replacement = trigger.getReplacementText(slashItem, "?", 0)
			expect(replacement).toBe("/")
		})

		it("should clear input for action shortcuts", () => {
			const trigger = createHelpTrigger()

			const tabItem: HelpShortcutResult = { key: "focus", shortcut: "tab", description: "to toggle focus" }
			const replacement = trigger.getReplacementText(tabItem, "?tab", 0)
			expect(replacement).toBe("")
		})

		it("should render shortcut items correctly", () => {
			const trigger = createHelpTrigger()

			const item: HelpShortcutResult = { key: "slash", shortcut: "/", description: "for commands" }
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			const output = lastFrame()
			expect(output).toContain("/")
			expect(output).toContain("for commands")
		})

		it("should render selected items with different styling", () => {
			const trigger = createHelpTrigger()

			const item: HelpShortcutResult = { key: "slash", shortcut: "/", description: "for commands" }
			const { lastFrame: unselectedFrame } = render(trigger.renderItem(item, false) as React.ReactElement)
			const { lastFrame: selectedFrame } = render(trigger.renderItem(item, true) as React.ReactElement)

			// Both should contain the content
			expect(unselectedFrame()).toContain("/")
			expect(selectedFrame()).toContain("/")
		})

		it("should have correct trigger configuration", () => {
			const trigger = createHelpTrigger()

			expect(trigger.id).toBe("help")
			expect(trigger.triggerChar).toBe("?")
			expect(trigger.position).toBe("line-start")
			expect(trigger.emptyMessage).toBe("No matching shortcuts")
			expect(trigger.debounceMs).toBe(0)
		})

		it("should have consumeTrigger set to true", () => {
			const trigger = createHelpTrigger()

			// The ? character should be consumed (not inserted into input)
			// when the help menu is triggered
			expect(trigger.consumeTrigger).toBe(true)
		})
	})
})
