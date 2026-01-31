/**
 * Tests for the /version command
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { versionCommand } from "../version.js"
import { createMockContext } from "./helpers/mockContext.js"

const getAutoUpdateStatusMock = vi.fn()

vi.mock("../../utils/auto-update.js", () => ({
	getAutoUpdateStatus: () => getAutoUpdateStatusMock(),
}))

describe("versionCommand", () => {
	beforeEach(() => {
		getAutoUpdateStatusMock.mockReset()
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(versionCommand.name).toBe("version")
		})

		it("should have correct aliases", () => {
			expect(versionCommand.aliases).toEqual(["about", "ver"])
		})

		it("should have correct description", () => {
			expect(versionCommand.description).toBe("Show CLI version information")
		})

		it("should have correct usage", () => {
			expect(versionCommand.usage).toBe("/version")
		})

		it("should have correct category", () => {
			expect(versionCommand.category).toBe("system")
		})

		it("should have examples", () => {
			expect(versionCommand.examples).toEqual(["/version", "/about", "/ver"])
		})
	})

	describe("handler", () => {
		it("should show up-to-date status when current version is latest", async () => {
			getAutoUpdateStatusMock.mockResolvedValue({
				name: "@kilocode/cli",
				isOutdated: false,
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
			})

			const addMessage = vi.fn()
			const context = createMockContext({
				input: "/version",
				addMessage,
			})

			await versionCommand.handler(context)

			expect(addMessage).toHaveBeenCalledTimes(1)
			const message = addMessage.mock.calls[0]![0]
			expect(message.type).toBe("system")
			expect(message.content).toContain("**Version Information**")
			expect(message.content).toContain("CLI:")
			expect(message.content).toContain("Node:")
			expect(message.content).toContain("OS:")
			expect(message.content).toContain("Update: up to date")
		})

		it("should show update instructions when a newer version is available", async () => {
			getAutoUpdateStatusMock.mockResolvedValue({
				name: "@kilocode/cli",
				isOutdated: true,
				currentVersion: "1.0.0",
				latestVersion: "1.2.0",
			})

			const addMessage = vi.fn()
			const context = createMockContext({
				input: "/version",
				addMessage,
			})

			await versionCommand.handler(context)

			const message = addMessage.mock.calls[0]![0]
			expect(message.content).toContain("Update: v1.2.0 available (current v1.0.0)")
			expect(message.content).toContain("Run: npm install -g @kilocode/cli")
		})
	})
})
