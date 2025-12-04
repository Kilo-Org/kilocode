/**
 * Tests for approval delay functionality
 */

import { describe, it, expect, afterEach } from "vitest"
import { createStore } from "jotai"
import {
	setPendingApprovalAtom,
	isApprovalPendingAtom,
	approvalSetTimestampAtom,
	clearPendingApprovalAtom,
} from "../approval.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

describe("approval delay", () => {
	afterEach(() => {
		// Cleanup if needed
	})

	it("should set timestamp when pending approval is set", () => {
		const store = createStore()
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "tool",
			text: '{"tool":"readFile"}',
		}

		store.set(setPendingApprovalAtom, message)

		const timestamp = store.get(approvalSetTimestampAtom)
		expect(timestamp).not.toBeNull()
		expect(typeof timestamp).toBe("number")
	})

	it("should clear timestamp when pending approval is cleared", () => {
		const store = createStore()
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "tool",
			text: '{"tool":"readFile"}',
		}

		store.set(setPendingApprovalAtom, message)
		expect(store.get(approvalSetTimestampAtom)).not.toBeNull()

		store.set(clearPendingApprovalAtom)
		expect(store.get(approvalSetTimestampAtom)).toBeNull()
	})

	it("isApprovalPendingAtom should return true immediately", () => {
		const store = createStore()
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "tool",
			text: '{"tool":"readFile"}',
		}

		store.set(setPendingApprovalAtom, message)

		// Immediate check should return true
		expect(store.get(isApprovalPendingAtom)).toBe(true)
	})

	it("should handle timestamp and approval state together", () => {
		const store = createStore()
		const message: ExtensionChatMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "tool",
			text: '{"tool":"readFile"}',
		}

		store.set(setPendingApprovalAtom, message)

		// Both timestamp and approval should be set
		expect(store.get(approvalSetTimestampAtom)).not.toBeNull()
		expect(store.get(isApprovalPendingAtom)).toBe(true)

		// Clear approval
		store.set(clearPendingApprovalAtom)

		// Both should be cleared
		expect(store.get(approvalSetTimestampAtom)).toBeNull()
		expect(store.get(isApprovalPendingAtom)).toBe(false)
	})
})
