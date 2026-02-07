/**
 * Tests for useCIMode hook behavior
 */

import React from "react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import { Provider } from "jotai"
import { render } from "ink-testing-library"
import { useCIMode } from "../useCIMode.js"
import { chatMessagesAtom, taskResumedViaContinueOrSessionAtom } from "../../atoms/extension.js"
import { ciCompletionDetectedAtom, ciCompletionIgnoreBeforeTimestampAtom, ciExitReasonAtom } from "../../atoms/ci.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

vi.mock("../../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const noop = () => {}

const TestComponent = ({ enabled }: { enabled: boolean }) => {
	useCIMode({ enabled, onExit: noop })
	return null
}

describe("useCIMode", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	it("skips historical completion_result after session resume", async () => {
		const completionMessage: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "completion_result",
			text: "Completed",
		}

		store.set(taskResumedViaContinueOrSessionAtom, true)
		store.set(ciCompletionIgnoreBeforeTimestampAtom, completionMessage.ts)
		store.set(chatMessagesAtom, [completionMessage])

		const { unmount } = render(
			<Provider store={store}>
				<TestComponent enabled={true} />
			</Provider>,
		)

		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(store.get(ciExitReasonAtom)).toBeNull()

		unmount()
	})

	it("exits on completion_result when not ignored", async () => {
		const completionMessage: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "completion_result",
			text: "Completed",
		}

		store.set(taskResumedViaContinueOrSessionAtom, false)
		store.set(ciCompletionIgnoreBeforeTimestampAtom, 0)
		store.set(chatMessagesAtom, [completionMessage])

		const { unmount } = render(
			<Provider store={store}>
				<TestComponent enabled={true} />
			</Provider>,
		)

		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(store.get(ciExitReasonAtom)).toBe("completion_result")

		unmount()
	})

	it("exits when a new completion_result arrives after the ignore timestamp", async () => {
		const historicalTs = Date.now()
		const historicalMessage: ExtensionChatMessage = {
			ts: historicalTs,
			type: "ask",
			ask: "completion_result",
			text: "Completed",
		}

		store.set(taskResumedViaContinueOrSessionAtom, false)
		store.set(ciCompletionIgnoreBeforeTimestampAtom, historicalTs)
		store.set(chatMessagesAtom, [historicalMessage])

		const { unmount } = render(
			<Provider store={store}>
				<TestComponent enabled={true} />
			</Provider>,
		)

		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(store.get(ciExitReasonAtom)).toBeNull()

		const newMessage: ExtensionChatMessage = {
			ts: historicalTs + 1000,
			type: "ask",
			ask: "completion_result",
			text: "Completed again",
		}

		store.set(chatMessagesAtom, [historicalMessage, newMessage])
		await new Promise((resolve) => setTimeout(resolve, 0))
		store.set(ciCompletionDetectedAtom, true)

		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(store.get(ciExitReasonAtom)).toBe("completion_result")

		unmount()
	})
})
