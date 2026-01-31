/**
 * Tests for the /skill command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { skillCommand } from "../skill.js"
import { createMockContext } from "./helpers/mockContext.js"
import type { CLIConfig } from "../../config/types.js"

describe("skill command", () => {
	let tempDir: string
	let projectSkillsDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilocode-skill-cmd-test-"))
		projectSkillsDir = path.join(tempDir, ".kilocode", "skills")
		await fs.mkdir(projectSkillsDir, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("command metadata", () => {
		it("should have correct name and aliases", () => {
			expect(skillCommand.name).toBe("skill")
			expect(skillCommand.aliases).toContain("skills")
		})

		it("should have correct category", () => {
			expect(skillCommand.category).toBe("settings")
		})

		it("should have examples", () => {
			expect(skillCommand.examples.length).toBeGreaterThan(0)
		})
	})

	describe("handler - no arguments", () => {
		it("should show help when no arguments provided", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: [],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Skill Command"),
				}),
			)
		})
	})

	describe("handler - list subcommand", () => {
		it("should show message when no skills installed", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["list"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			// First call is "Loading..." message
			// Second call is the result
			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("No skills installed"),
				}),
			)
		})

		it("should list installed skills", async () => {
			// Create a test skill
			const skillDir = path.join(projectSkillsDir, "test-skill")
			await fs.mkdir(skillDir, { recursive: true })
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				`---
name: Test Skill
description: A test skill
---
`,
			)

			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["list"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Test Skill"),
				}),
			)
		})
	})

	describe("handler - add subcommand", () => {
		it("should show error when no source provided", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["add"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage"),
				}),
			)
		})

		it("should show error for invalid source format", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["add", "invalid-source"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					content: expect.stringContaining("Invalid source format"),
				}),
			)
		})
	})

	describe("handler - remove subcommand", () => {
		it("should show error when no name provided", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["remove"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("Usage"),
				}),
			)
		})

		it("should remove an installed skill", async () => {
			// Create a test skill
			const skillDir = path.join(projectSkillsDir, "removable")
			await fs.mkdir(skillDir, { recursive: true })
			await fs.writeFile(
				path.join(skillDir, "SKILL.md"),
				`---
name: Removable Skill
---
`,
			)

			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["remove", "removable"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "system",
					content: expect.stringContaining("Removed skill"),
				}),
			)

			// Verify skill is removed
			const exists = await fs
				.access(skillDir)
				.then(() => true)
				.catch(() => false)
			expect(exists).toBe(false)
		})

		it("should show error for non-existent skill", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["remove", "non-existent"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("not found"),
				}),
			)
		})
	})

	describe("handler - unknown subcommand", () => {
		it("should show error for unknown subcommand", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["unknown"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining('Unknown subcommand "unknown"'),
				}),
			)
		})
	})

	describe("subcommand aliases", () => {
		it("should support 'install' as alias for 'add'", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["install", "owner/repo"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			// Should try to install (will fail but should attempt)
			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					content: expect.stringContaining("Installing skills"),
				}),
			)
		})

		it("should support 'ls' as alias for 'list'", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["ls"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					content: expect.stringContaining("Loading installed skills"),
				}),
			)
		})

		it("should support 'rm' as alias for 'remove'", async () => {
			const addMessage = vi.fn()
			const context = createMockContext({
				args: ["rm", "some-skill"],
				addMessage,
				config: { cwd: tempDir } as CLIConfig,
			})

			await skillCommand.handler(context)

			// Should try to remove (will fail but should attempt)
			expect(addMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "error",
					content: expect.stringContaining("not found"),
				}),
			)
		})
	})
})
