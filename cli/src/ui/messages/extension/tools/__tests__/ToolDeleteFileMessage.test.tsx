/**
 * Tests for ToolDeleteFileMessage component
 *
 * This test suite verifies that the ToolDeleteFileMessage component correctly displays
 * file and directory deletion information.
 */

import { describe, it, expect, vi } from "vitest"
import { render } from "ink-testing-library"
import { ToolDeleteFileMessage } from "../ToolDeleteFileMessage.js"
import type { ExtensionChatMessage } from "../../../../../types/messages.js"
import type { ToolData } from "../../types.js"

// Mock the logs service
vi.mock("../../../../../services/logs.js", () => ({
	logs: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

describe("ToolDeleteFileMessage", () => {
	const createMessage = (): ExtensionChatMessage => ({
		ts: Date.now(),
		type: "ask",
		ask: "tool",
		text: "",
	})

	describe("Single file deletion", () => {
		it("should display file path for single file deletion", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/test.ts",
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("src/test.ts")
		})

		it("should display delete icon (🗑️) for file deletion", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "test.ts",
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("🗑️")
		})

		it("should display Delete action label", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "test.ts",
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("Delete")
		})

		it("should format path by removing leading ./", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "./src/test.ts",
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("src/test.ts")
			expect(lastFrame()).not.toContain("./src/test.ts")
		})
	})

	describe("Directory deletion", () => {
		it("should display directory path for directory deletion", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 5,
					directories: 2,
					size: 1024,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("src/components")
		})

		it("should display file count for directory deletion", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 5,
					directories: 2,
					size: 1024,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("5 files")
		})

		it("should display directory count for directory deletion", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 5,
					directories: 2,
					size: 1024,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("2 dirs")
		})

		it("should display singular 'file' when count is 1", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 1,
					directories: 0,
					size: 512,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("1 file")
			expect(lastFrame()).not.toContain("1 files")
		})

		it("should display singular 'dir' when count is 1", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 0,
					directories: 1,
					size: 0,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("1 dir")
			expect(lastFrame()).not.toContain("1 dirs")
		})

		it("should show scanning indicator when isComplete is false", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 0,
					directories: 0,
					size: 0,
					isComplete: false,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("scanning")
		})

		it("should not show scanning indicator when isComplete is true", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/components",
				stats: {
					files: 5,
					directories: 2,
					size: 1024,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).not.toContain("scanning")
		})
	})

	describe("Warning indicators", () => {
		it("should display outside workspace warning when isOutsideWorkspace is true", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "/etc/config",
				isOutsideWorkspace: true,
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toContain("⚠")
		})

		it("should not display outside workspace warning when isOutsideWorkspace is false", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "src/test.ts",
				isOutsideWorkspace: false,
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			// Should not contain warning symbol (but may contain other content)
			const frame = lastFrame() || ""
			// Count occurrences of ⚠ - should be 0
			const warningCount = (frame.match(/⚠/g) || []).length
			expect(warningCount).toBe(0)
		})
	})

	describe("Edge cases", () => {
		it("should handle empty path gracefully", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "",
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Delete")
		})

		it("should handle undefined path gracefully", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("Delete")
		})

		it("should handle zero stats for directory", () => {
			const toolData: ToolData = {
				tool: "deleteFile",
				path: "empty-dir",
				stats: {
					files: 0,
					directories: 0,
					size: 0,
					isComplete: true,
				},
			}

			const { lastFrame } = render(<ToolDeleteFileMessage message={createMessage()} toolData={toolData} />)

			expect(lastFrame()).toBeDefined()
			expect(lastFrame()).toContain("empty-dir")
		})
	})
})
