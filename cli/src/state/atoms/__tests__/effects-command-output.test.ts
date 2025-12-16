/**
 * Tests for command execution status handling in effects.ts
 * Specifically tests the CLI-only workaround for commands that produce no output (like `sleep 10`)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { messageHandlerEffectAtom, pendingOutputUpdatesAtom } from "../effects.js"
import { extensionServiceAtom } from "../service.js"
import { chatMessagesAtom } from "../extension.js"
import type { ExtensionMessage } from "../../../types/messages.js"
import type { CommandExecutionStatus } from "@roo-code/types"
import type { ExtensionService } from "../../../services/extension.js"

describe("Command Execution Status - CLI-Only Workaround", () => {
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

	it("should synthesize command_output ask immediately on start and update on exit", () => {
		const executionId = "test-exec-123"
		const command = "sleep 10"

		// Simulate command started
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
		let pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.has(executionId)).toBe(true)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "sleep 10",
		})

		// Verify synthetic command_output ask was created IMMEDIATELY
		let messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1)
		expect(messages[0]).toMatchObject({
			type: "ask",
			ask: "command_output",
			partial: true, // Still running
			isAnswered: false,
		})

		// Verify the synthetic ask has the correct initial data
		const askData = JSON.parse(messages[0]!.text || "{}")
		expect(askData).toEqual({
			executionId: "test-exec-123",
			command: "sleep 10",
			output: "",
		})

		// Simulate command exited without any output
		const exitedStatus: CommandExecutionStatus = {
			status: "exited",
			executionId,
			exitCode: 0,
		}

		const exitedMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify(exitedStatus),
		}

		store.set(messageHandlerEffectAtom, exitedMessage)

		// Verify command info is preserved and marked as completed
		pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.has(executionId)).toBe(true)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "sleep 10",
			completed: true,
		})

		// Verify the ask was updated to mark as complete (not partial)
		messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1) // Still just one message
		expect(messages[0]).toMatchObject({
			type: "ask",
			ask: "command_output",
			partial: false, // Now complete
			isAnswered: false,
		})
	})

	it("should handle commands with output (started -> output -> exited)", () => {
		const executionId = "test-exec-456"
		const command = "echo hello"

		// Simulate command started
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

		// Verify initial state
		let pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "echo hello",
		})

		// Verify synthetic ask was created on start
		let messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1)
		expect(messages[0]?.partial).toBe(true)

		// Simulate output received
		const outputStatus: CommandExecutionStatus = {
			status: "output",
			executionId,
			output: "hello\n",
		}

		const outputMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify(outputStatus),
		}

		store.set(messageHandlerEffectAtom, outputMessage)

		// Verify output was updated
		pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "hello\n",
			command: "echo hello",
		})

		// Verify the synthetic ask was updated with output
		messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1)
		const askData = JSON.parse(messages[0]!.text || "{}")
		expect(askData.output).toBe("hello\n")
		expect(messages[0]?.partial).toBe(true) // Still running

		// Simulate command exited
		const exitedStatus: CommandExecutionStatus = {
			status: "exited",
			executionId,
			exitCode: 0,
		}

		const exitedMessage: ExtensionMessage = {
			type: "commandExecutionStatus",
			text: JSON.stringify(exitedStatus),
		}

		store.set(messageHandlerEffectAtom, exitedMessage)

		// Verify final state
		pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "hello\n",
			command: "echo hello",
			completed: true,
		})

		// Verify the ask was marked as complete
		messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1)
		expect(messages[0]?.partial).toBe(false) // Now complete
	})

	it("should handle timeout status", () => {
		const executionId = "test-exec-789"
		const command = "sleep 1000"

		// Simulate command started
		const startedStatus: CommandExecutionStatus = {
			status: "started",
			executionId,
			command,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(startedStatus),
		})

		// Simulate timeout
		const timeoutStatus: CommandExecutionStatus = {
			status: "timeout",
			executionId,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(timeoutStatus),
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
		const startedStatus: CommandExecutionStatus = {
			status: "started",
			executionId,
			command: "",
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(startedStatus),
		})

		// Verify it still creates an entry with empty command
		const pendingUpdates = store.get(pendingOutputUpdatesAtom)
		expect(pendingUpdates.get(executionId)).toEqual({
			output: "",
			command: "",
		})
	})

	it("should include exitCode in JSON output when command exits with non-zero code", () => {
		const executionId = "test-exec-exit-code"
		const command = "exit 1"

		// Simulate command started
		const startedStatus: CommandExecutionStatus = {
			status: "started",
			executionId,
			command,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(startedStatus),
		})

		// Verify synthetic ask was created
		let messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1)

		// Simulate command exited with non-zero exit code
		const exitedStatus: CommandExecutionStatus = {
			status: "exited",
			executionId,
			exitCode: 1,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(exitedStatus),
		})

		// Verify the ask was updated with exitCode
		messages = store.get(chatMessagesAtom)
		expect(messages.length).toBe(1)
		expect(messages[0]?.partial).toBe(false) // Command completed

		const askData = JSON.parse(messages[0]!.text || "{}")
		expect(askData.exitCode).toBe(1)
		expect(askData.executionId).toBe(executionId)
		expect(askData.command).toBe(command)
	})

	it("should include exitCode 0 in JSON output when command exits successfully", () => {
		const executionId = "test-exec-exit-code-zero"
		const command = "echo success"

		// Simulate command started
		const startedStatus: CommandExecutionStatus = {
			status: "started",
			executionId,
			command,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(startedStatus),
		})

		// Simulate command exited with exit code 0
		const exitedStatus: CommandExecutionStatus = {
			status: "exited",
			executionId,
			exitCode: 0,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(exitedStatus),
		})

		// Verify the ask was updated with exitCode 0
		const messages = store.get(chatMessagesAtom)
		const askData = JSON.parse(messages[0]!.text || "{}")
		expect(askData.exitCode).toBe(0)
	})

	it("should NOT include exitCode in JSON output when command times out", () => {
		const executionId = "test-exec-timeout-no-exitcode"
		const command = "sleep 1000"

		// Simulate command started
		const startedStatus: CommandExecutionStatus = {
			status: "started",
			executionId,
			command,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(startedStatus),
		})

		// Simulate timeout (no exitCode)
		const timeoutStatus: CommandExecutionStatus = {
			status: "timeout",
			executionId,
		}

		store.set(messageHandlerEffectAtom, {
			type: "commandExecutionStatus",
			text: JSON.stringify(timeoutStatus),
		})

		// Verify the ask does NOT have exitCode
		const messages = store.get(chatMessagesAtom)
		const askData = JSON.parse(messages[0]!.text || "{}")
		expect(askData.exitCode).toBeUndefined()
		expect(askData.executionId).toBe(executionId)
	})
})
