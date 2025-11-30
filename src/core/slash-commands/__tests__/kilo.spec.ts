import { parseKiloSlashCommands } from "../kilo"
import { ClineRulesToggles } from "../../../shared/cline-rules"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("parseKiloSlashCommands", () => {
	const emptyToggles: ClineRulesToggles = {}

	describe("when no slash commands are present", () => {
		it("should return the original text unchanged", async () => {
			const text = "<task>Hello world</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toBe(text)
			expect(result.needsRulesFileCheck).toBe(false)
		})

		it("should return original text for plain text without tags", async () => {
			const text = "Just some plain text"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toBe(text)
			expect(result.needsRulesFileCheck).toBe(false)
		})
	})

	describe("built-in commands", () => {
		describe("/newtask command", () => {
			it("should process /newtask in <task> tags", async () => {
				const text = "<task>/newtask</task>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="new_task">')
				expect(result.processedText).not.toContain("/newtask")
				expect(result.needsRulesFileCheck).toBe(false)
			})

			it("should process /newtask with additional content", async () => {
				const text = "<task>/newtask Create a new feature</task>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="new_task">')
				expect(result.processedText).toContain("Create a new feature")
				expect(result.needsRulesFileCheck).toBe(false)
			})

			it("should process /newtask with leading whitespace", async () => {
				const text = "<task>  /newtask</task>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="new_task">')
				expect(result.needsRulesFileCheck).toBe(false)
			})
		})

		describe("/newrule command", () => {
			it("should process /newrule and set needsRulesFileCheck to true", async () => {
				const text = "<task>/newrule</task>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="new_rule">')
				expect(result.needsRulesFileCheck).toBe(true)
			})

			it("should process /newrule with additional content", async () => {
				const text = "<feedback>/newrule Add coding standards</feedback>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="new_rule">')
				expect(result.processedText).toContain("Add coding standards")
				expect(result.needsRulesFileCheck).toBe(true)
			})
		})

		describe("/reportbug command", () => {
			it("should process /reportbug command", async () => {
				const text = "<task>/reportbug</task>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="report_bug">')
				expect(result.needsRulesFileCheck).toBe(false)
			})

			it("should process /reportbug with bug description", async () => {
				const text = "<answer>/reportbug The app crashes on startup</answer>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="report_bug">')
				expect(result.processedText).toContain("The app crashes on startup")
				expect(result.needsRulesFileCheck).toBe(false)
			})
		})

		describe("/smol command", () => {
			it("should process /smol command", async () => {
				const text = "<task>/smol</task>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="condense">')
				expect(result.needsRulesFileCheck).toBe(false)
			})

			it("should process /smol with additional instructions", async () => {
				const text = "<user_message>/smol Focus on the API changes</user_message>"
				const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

				expect(result.processedText).toContain('<explicit_instructions type="condense">')
				expect(result.processedText).toContain("Focus on the API changes")
				expect(result.needsRulesFileCheck).toBe(false)
			})
		})
	})

	describe("tag patterns", () => {
		it("should process commands in <task> tags", async () => {
			const text = "<task>/newtask</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain('<explicit_instructions type="new_task">')
		})

		it("should process commands in <feedback> tags", async () => {
			const text = "<feedback>/newtask</feedback>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain('<explicit_instructions type="new_task">')
		})

		it("should process commands in <answer> tags", async () => {
			const text = "<answer>/newtask</answer>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain('<explicit_instructions type="new_task">')
		})

		it("should process commands in <user_message> tags", async () => {
			const text = "<user_message>/newtask</user_message>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain('<explicit_instructions type="new_task">')
		})

		it("should not process commands outside of recognized tags", async () => {
			const text = "<other>/newtask</other>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toBe(text)
			expect(result.needsRulesFileCheck).toBe(false)
		})
	})

	describe("case sensitivity", () => {
		it("should not match uppercase command names", async () => {
			const text = "<task>/NEWTASK</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			// NEWTASK is not a recognized command (case-sensitive)
			expect(result.processedText).toBe(text)
		})

		it("should not match mixed case command names", async () => {
			const text = "<task>/NewTask</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toBe(text)
		})
	})

	describe("workflow toggles", () => {
		let tempDir: string
		let workflowFilePath: string

		beforeEach(async () => {
			tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-test-"))
			workflowFilePath = path.join(tempDir, "my-workflow.md")
			await fs.writeFile(workflowFilePath, "# My Workflow\n\nThis is workflow content.")
		})

		afterEach(async () => {
			await fs.rm(tempDir, { recursive: true, force: true })
		})

		it("should process local workflow toggle commands", async () => {
			const localToggles: ClineRulesToggles = {
				[workflowFilePath]: true,
			}

			const text = "<task>/my-workflow.md</task>"
			const result = await parseKiloSlashCommands(text, localToggles, emptyToggles)

			expect(result.processedText).toContain('<explicit_instructions type="my-workflow.md">')
			expect(result.processedText).toContain("# My Workflow")
			expect(result.processedText).toContain("This is workflow content.")
			expect(result.needsRulesFileCheck).toBe(false)
		})

		it("should process global workflow toggle commands", async () => {
			const globalToggles: ClineRulesToggles = {
				[workflowFilePath]: true,
			}

			const text = "<task>/my-workflow.md</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, globalToggles)

			expect(result.processedText).toContain('<explicit_instructions type="my-workflow.md">')
			expect(result.processedText).toContain("# My Workflow")
			expect(result.needsRulesFileCheck).toBe(false)
		})

		it("should not process disabled workflow toggles", async () => {
			const localToggles: ClineRulesToggles = {
				[workflowFilePath]: false,
			}

			const text = "<task>/my-workflow.md</task>"
			const result = await parseKiloSlashCommands(text, localToggles, emptyToggles)

			// Disabled workflow should not be processed
			expect(result.processedText).toBe(text)
		})

		it("should prefer local workflow over global when both exist", async () => {
			const localWorkflowPath = path.join(tempDir, "shared-workflow.md")
			await fs.writeFile(localWorkflowPath, "Local workflow content")

			const globalWorkflowPath = path.join(tempDir, "global", "shared-workflow.md")
			await fs.mkdir(path.dirname(globalWorkflowPath), { recursive: true })
			await fs.writeFile(globalWorkflowPath, "Global workflow content")

			const localToggles: ClineRulesToggles = {
				[localWorkflowPath]: true,
			}
			const globalToggles: ClineRulesToggles = {
				[globalWorkflowPath]: true,
			}

			const text = "<task>/shared-workflow.md</task>"
			const result = await parseKiloSlashCommands(text, localToggles, globalToggles)

			// Local should be found first due to array order
			expect(result.processedText).toContain("Local workflow content")
			expect(result.processedText).not.toContain("Global workflow content")
		})

		it("should handle workflow file read errors gracefully", async () => {
			const nonExistentPath = path.join(tempDir, "non-existent.md")
			const localToggles: ClineRulesToggles = {
				[nonExistentPath]: true,
			}

			const text = "<task>/non-existent.md</task>"
			const result = await parseKiloSlashCommands(text, localToggles, emptyToggles)

			// Should return original text when file read fails
			expect(result.processedText).toBe(text)
			expect(result.needsRulesFileCheck).toBe(false)
		})

		it("should trim workflow file content", async () => {
			const paddedWorkflowPath = path.join(tempDir, "padded.md")
			await fs.writeFile(paddedWorkflowPath, "  \n\nContent with padding\n\n  ")

			const localToggles: ClineRulesToggles = {
				[paddedWorkflowPath]: true,
			}

			const text = "<task>/padded.md</task>"
			const result = await parseKiloSlashCommands(text, localToggles, emptyToggles)

			expect(result.processedText).toContain("Content with padding")
			// The content should be trimmed
			expect(result.processedText).not.toMatch(/explicit_instructions[^>]*>\s{2,}/)
		})
	})

	describe("command with surrounding content", () => {
		it("should not process command when there is content before it (command must be at start)", async () => {
			const text = "<task>Some context before /newtask</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			// The regex requires the command to be at the start of the tag content
			expect(result.processedText).toBe(text)
			expect(result.needsRulesFileCheck).toBe(false)
		})

		it("should preserve content after the command", async () => {
			const text = "<task>/newtask and some content after</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain("and some content after")
			expect(result.processedText).toContain('<explicit_instructions type="new_task">')
		})

		it("should preserve content outside the tags", async () => {
			const text = "Before <task>/newtask</task> After"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain("Before")
			expect(result.processedText).toContain("After")
		})
	})

	describe("unrecognized commands", () => {
		it("should not process unrecognized slash commands", async () => {
			const text = "<task>/unknowncommand</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toBe(text)
			expect(result.needsRulesFileCheck).toBe(false)
		})

		it("should not process commands with special characters", async () => {
			const text = "<task>/new-task</task>"
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			// new-task is not a built-in command (newtask is)
			expect(result.processedText).toBe(text)
		})
	})

	describe("multiline content", () => {
		it("should handle multiline content in tags", async () => {
			const text = `<task>
/newtask
Create a new feature
with multiple lines
</task>`
			const result = await parseKiloSlashCommands(text, emptyToggles, emptyToggles)

			expect(result.processedText).toContain('<explicit_instructions type="new_task">')
			expect(result.processedText).toContain("Create a new feature")
			expect(result.processedText).toContain("with multiple lines")
		})
	})
})
