/**
 * Tests for CI completion detection in effects.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { messageHandlerEffectAtom } from "../effects.js"
import { extensionServiceAtom } from "../service.js"
import { ciCompletionDetectedAtom, ciCompletionIgnoreBeforeTimestampAtom } from "../ci.js"
import { taskResumedViaContinueOrSessionAtom } from "../extension.js"
import type { ExtensionMessage, ExtensionChatMessage } from "../../../types/messages.js"
import type { ExtensionService } from "../../../services/extension.js"

describe("CI completion detection in effects", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()

		const mockService: Partial<ExtensionService> = {
			initialize: vi.fn(),
			dispose: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		}
		store.set(extensionServiceAtom, mockService as ExtensionService)
	})

	it("skips completion detection when session was resumed", () => {
		const completionMessage: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "completion_result",
			text: "Task completed",
		}

		const stateMessage: ExtensionMessage = {
			type: "state",
			state: {
				chatMessages: [completionMessage],
			} as ExtensionMessage["state"],
		}

		store.set(taskResumedViaContinueOrSessionAtom, true)
		store.set(messageHandlerEffectAtom, stateMessage)

		expect(store.get(ciCompletionDetectedAtom)).toBe(false)
	})

	it("uses the ignore timestamp to skip historical completion_result", () => {
		const historicalTs = Date.now()
		const completionMessage: ExtensionChatMessage = {
			ts: historicalTs,
			type: "ask",
			ask: "completion_result",
			text: "Task completed",
		}

		const stateMessage: ExtensionMessage = {
			type: "state",
			state: {
				chatMessages: [completionMessage],
			} as ExtensionMessage["state"],
		}

		store.set(ciCompletionIgnoreBeforeTimestampAtom, historicalTs)
		store.set(messageHandlerEffectAtom, stateMessage)

		expect(store.get(ciCompletionDetectedAtom)).toBe(false)
	})
})
