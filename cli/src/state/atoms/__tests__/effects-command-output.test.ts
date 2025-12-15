/**
 * Tests for command execution status handling in effects.ts
 * Tests that command status is tracked in pendingOutputUpdatesAtom
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { messageHandlerEffectAtom, pendingOutputUpdatesAtom } from "../effects.js"
import { extensionServiceAtom } from "../service.js"
import type { ExtensionMessage } from "../../../types/messages.js"
import type { CommandExecutionStatus } from "@roo-code/types"
import type { ExtensionService } from "../../../services/extension.js"

describe("Command Execution Status Tracking", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()

		// Mock the extension service to prevent buffering
		const mockService: Partial<ExtensionService> = {
			initialize: vi.fn(),
			dispose: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		}
		store.set(extensionServiceAtom, mockService as ExtensionService)
	})

	it("should track command started status", () => {
		const executionId = "test-exec-123"
		const command = "sleep 10"

		const startedStatus: CommandExecutionStatus = {
			status: "started",
			executionId,
			command,
		}

		const startedMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify(startedStatus),
		}

		store.set(messageHandlerEffectAtom, startedMessage)

		// Verify pending updates were created with command info
		const pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.has(executionId)).toBe(true)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "sleep 10",
		})
	})

	it("should track command output", () => {
		const executionId = "test-exec-456"
		const command = "echo hello"

		// Simulate command started
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "started",
				executionId,
				command,
			}),
		})

		// Simulate output received
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "output",
				executionId,
				output: "hello\n",
			}),
		})

		// Verify output was tracked
		const pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "hello\n",
			command: "echo hello",
		})
	})

	it("should track command exit status", () => {
		const executionId = "test-exec-789"
		const command = "sleep 10"

		// Simulate command started
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "started",
				executionId,
				command,
			}),
		})

		// Simulate command exited
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "exited",
				executionId,
				exitCode: 0,
			}),
		})

		// Verify command info is preserved and marked as completed
		const pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "sleep 10",
			completed: true,
		})
	})

	it("should handle timeout status", () => {
		const executionId = "test-exec-timeout"
		const command = "sleep 1000"

		// Simulate command started
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "started",
				executionId,
				command,
			}),
		})

		// Simulate timeout
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "timeout",
				executionId,
			}),
		})

		// Verify command info is preserved and marked as completed
		const pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "sleep 1000",
			completed: true,
		})
	})

	it("should handle empty command in started status", () => {
		const executionId = "test-exec-no-cmd"

		// Simulate command started with empty command field
		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify({
				status: "started",
				executionId,
				command: "",
			}),
		})

		// Verify it still creates an entry with empty command
		const pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "",
		})
	})
})
