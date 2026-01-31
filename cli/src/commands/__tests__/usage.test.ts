/**
 * Tests for the /usage command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { usageCommand } from "../usage.js"
import { createMockContext } from "./helpers/mockContext.js"
import type { CommandContext } from "../core/types.js"
import type { HistoryItem } from "../../types/messages.js"

function createHistoryItem(overrides: Record<string, unknown> = {}): HistoryItem {
	return {
		id: "task-1",
		number: 1,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 200,
		totalCost: 0.01,
		...overrides,
	} as HistoryItem
}

describe("/usage command", () => {
	let mockContext: CommandContext
	let addMessageMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-01-31T12:00:00Z"))
		addMessageMock = vi.fn()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("summarizes usage with top tasks, breakdown, and daily trend", async () => {
		const page1 = {
			historyItems: [
				createHistoryItem({
					id: "task-1",
					ts: Date.parse("2026-01-30T08:00:00Z"),
					task: "Fix billing bug",
					tokensIn: 1000,
					tokensOut: 2000,
					totalCost: 2.5,
					provider: "openrouter",
					model: "gpt-4.1",
				}),
				createHistoryItem({
					id: "task-2",
					ts: Date.parse("2026-01-25T10:00:00Z"),
					task: "Add onboarding flow",
					tokensIn: 500,
					tokensOut: 800,
					totalCost: 1.0,
					provider: "kilocode",
					model: "gpt-5.2-codex",
				}),
			],
			pageIndex: 0,
			pageCount: 2,
		}

		const page2 = {
			historyItems: [
				createHistoryItem({
					id: "task-3",
					ts: Date.parse("2026-01-10T10:00:00Z"),
					task: "Old task",
					tokensIn: 300,
					tokensOut: 400,
					totalCost: 0.5,
					provider: "openrouter",
					model: "gpt-4.1",
				}),
			],
			pageIndex: 1,
			pageCount: 2,
		}

		const updateTaskHistoryFilters = vi.fn().mockResolvedValue(page1)
		const changeTaskHistoryPage = vi.fn().mockResolvedValue(page2)

		mockContext = createMockContext({
			input: "/usage --since 7d --workspace all --top 5",
			args: [],
			options: { since: "7d", workspace: "all", top: 5 },
			addMessage: addMessageMock,
			updateTaskHistoryFilters,
			changeTaskHistoryPage,
		})

		await usageCommand.handler(mockContext)

		expect(addMessageMock).toHaveBeenCalled()
		const lastMessage = addMessageMock.mock.calls[addMessageMock.mock.calls.length - 1][0]
		expect(lastMessage.type).toBe("system")
		expect(lastMessage.content).toContain("Usage Summary")
		expect(lastMessage.content).toContain("Total tasks: 2")
		expect(lastMessage.content).toContain("$3.50")
		expect(lastMessage.content).toContain("openrouter / gpt-4.1")
		expect(lastMessage.content).toContain("kilocode / gpt-5.2-codex")
		expect(lastMessage.content).toContain("Daily spend")

		const indexTask1 = lastMessage.content.indexOf("task-1")
		const indexTask2 = lastMessage.content.indexOf("task-2")
		expect(indexTask1).toBeGreaterThan(-1)
		expect(indexTask2).toBeGreaterThan(-1)
		expect(indexTask1).toBeLessThan(indexTask2)
	})

	it("shows an error for invalid since value", async () => {
		mockContext = createMockContext({
			input: "/usage --since banana",
			args: [],
			options: { since: "banana" },
			addMessage: addMessageMock,
		})

		await usageCommand.handler(mockContext)

		expect(addMessageMock).toHaveBeenCalledTimes(1)
		const message = addMessageMock.mock.calls[0][0]
		expect(message.type).toBe("error")
		expect(message.content).toContain("--since")
	})

	it("shows an error for invalid workspace", async () => {
		mockContext = createMockContext({
			input: "/usage --workspace foo",
			args: [],
			options: { workspace: "foo" },
			addMessage: addMessageMock,
		})

		await usageCommand.handler(mockContext)

		expect(addMessageMock).toHaveBeenCalledTimes(1)
		const message = addMessageMock.mock.calls[0][0]
		expect(message.type).toBe("error")
		expect(message.content).toContain("--workspace")
	})

	it("reports when no tasks are in range", async () => {
		const updateTaskHistoryFilters = vi.fn().mockResolvedValue({
			historyItems: [],
			pageIndex: 0,
			pageCount: 0,
		})

		mockContext = createMockContext({
			input: "/usage --since 7d",
			args: [],
			options: { since: "7d" },
			addMessage: addMessageMock,
			updateTaskHistoryFilters,
		})

		await usageCommand.handler(mockContext)

		const lastMessage = addMessageMock.mock.calls[addMessageMock.mock.calls.length - 1][0]
		expect(lastMessage.type).toBe("system")
		expect(lastMessage.content).toContain("No tasks found")
	})
})
