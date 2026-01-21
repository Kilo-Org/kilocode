import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import os from "node:os"
import { loadCustomSlashCommands } from "../customSlashCommands.js"
import { expandSlashCommandTemplate } from "../slashCommandTemplate.js"

const originalHome = process.env.HOME

describe("customSlashCommands", () => {
	beforeEach(async () => {
		const tempHome = await mkdtemp(join(os.tmpdir(), "kc-home-"))
		process.env.HOME = tempHome
	})

	afterEach(() => {
		process.env.HOME = originalHome
	})

	it("expands slash command templates with arguments", () => {
		expect(expandSlashCommandTemplate("Hello $ARGUMENTS", ["foo", "bar"])).toBe("Hello foo bar")
		expect(expandSlashCommandTemplate("First $1, second $2", ["alpha", "beta"])).toBe("First alpha, second beta")
		expect(expandSlashCommandTemplate("Missing $3", ["alpha"])).toBe("Missing ")
		expect(expandSlashCommandTemplate("Cost \\$5", [])).toBe("Cost $5")
	})

	it("loads project commands with precedence over user commands", async () => {
		const workspace = await mkdtemp(join(os.tmpdir(), "kc-workspace-"))
		const userCommandsDir = join(process.env.HOME || "", ".kilocode", "cli", "commands")
		const projectCommandsDir = join(workspace, ".kilocode", "commands")

		await mkdir(userCommandsDir, { recursive: true })
		await mkdir(projectCommandsDir, { recursive: true })

		await writeFile(
			join(userCommandsDir, "audit.md"),
			`---\ndescription: User audit\nargument-hint: "<path>"\n---\nUser body`,
			"utf-8",
		)
		await writeFile(
			join(projectCommandsDir, "audit.md"),
			`---\ndescription: Project audit\nallowed-tools:\n  - Read(src/**)\n---\nProject body`,
			"utf-8",
		)

		const commands = await loadCustomSlashCommands(workspace)
		const audit = commands.find((cmd) => cmd.name === "audit")

		expect(audit).toBeDefined()
		expect(audit?.description).toBe("Project audit")
		expect(audit?.metadata.scope).toBe("project")
		expect(audit?.metadata.allowedTools?.[0]?.type).toBe("read")
	})
})
