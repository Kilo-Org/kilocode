/**
 * Tests for approval system race condition fixes
 *
 * These tests verify that the atomic state operations prevent:
 * - Duplicate approval attempts
 * - Stale closure issues
 * - UI not hiding after approval/rejection
 * - Synchronization issues between components
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { createStore } from "jotai"
import {
	pendingApprovalAtom,
	approvalProcessingAtom,
	setPendingApprovalAtom,
	clearPendingApprovalAtom,
	startApprovalProcessingAtom,
	completeApprovalProcessingAtom,
	isApprovalPendingAtom,
} from "../approval.js"
import type { ExtensionChatMessage } from "../../../types/messages.js"

describe("Approval Race Condition Fixes", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	const createMockMessage = (ts: number, isAnswered = false): ExtensionChatMessage => ({
		ts,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "listFilesTopLevel", path: "." }),
		partial: false,
		isAnswered,
	})

	describe("Atomic State Operations", () => {
		it("should prevent setting pending approval while processing", () => {
			const message1 = createMockMessage(1000)
			const message2 = createMockMessage(2000)

			// Set first message as pending
			store.set(setPendingApprovalAtom, message1)
			expect(store.get(pendingApprovalAtom)).toBe(message1)

			// Start processing
			const started = store.set(startApprovalProcessingAtom, "approve")
			expect(started).toBe(true)
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(true)

			// Try to set second message while processing - should be ignored
			store.set(setPendingApprovalAtom, message2)
			expect(store.get(pendingApprovalAtom)).toBe(message1) // Still first message
		})

		it("should prevent duplicate approval processing", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)

			// Start processing first time
			const started1 = store.set(startApprovalProcessingAtom, "approve")
			expect(started1).toBe(true)

			// Try to start processing again - should fail
			const started2 = store.set(startApprovalProcessingAtom, "approve")
			expect(started2).toBe(false)

			const processing = store.get(approvalProcessingAtom)
			expect(processing.isProcessing).toBe(true)
			expect(processing.processingTs).toBe(1000)
		})

		it("should clear both pending and processing state atomically", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			store.set(startApprovalProcessingAtom, "approve")

			expect(store.get(pendingApprovalAtom)).toBe(message)
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(true)

			// Complete processing - should clear both
			store.set(completeApprovalProcessingAtom)

			expect(store.get(pendingApprovalAtom)).toBeNull()
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(false)
		})
	})

	describe("UI Visibility", () => {
		it("should hide approval UI while processing", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			expect(store.get(isApprovalPendingAtom)).toBe(true)

			// Start processing
			store.set(startApprovalProcessingAtom, "approve")

			// UI should be hidden while processing
			expect(store.get(isApprovalPendingAtom)).toBe(false)
		})

		it("should hide approval UI after completion", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			store.set(startApprovalProcessingAtom, "approve")
			store.set(completeApprovalProcessingAtom)

			// UI should be hidden after completion
			expect(store.get(isApprovalPendingAtom)).toBe(false)
			expect(store.get(pendingApprovalAtom)).toBeNull()
		})
	})

	describe("Message State Handling", () => {
		it("should not set pending approval for answered messages", () => {
			const message = createMockMessage(1000, true)

			store.set(setPendingApprovalAtom, message)

			// Should not set pending approval for answered message
			expect(store.get(pendingApprovalAtom)).toBeNull()
		})

		it("should clear pending approval when message is answered", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			expect(store.get(pendingApprovalAtom)).toBe(message)

			// Clear when answered
			store.set(clearPendingApprovalAtom)
			expect(store.get(pendingApprovalAtom)).toBeNull()
		})

		it("should handle multiple messages sequentially", () => {
			const message1 = createMockMessage(1000)
			const message2 = createMockMessage(2000)

			// Process first message
			store.set(setPendingApprovalAtom, message1)
			store.set(startApprovalProcessingAtom, "approve")
			store.set(completeApprovalProcessingAtom)

			// Now process second message
			store.set(setPendingApprovalAtom, message2)
			expect(store.get(pendingApprovalAtom)).toBe(message2)

			const started = store.set(startApprovalProcessingAtom, "approve")
			expect(started).toBe(true)
		})
	})

	describe("Processing State Tracking", () => {
		it("should track processing operation type", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			store.set(startApprovalProcessingAtom, "approve")

			const processing = store.get(approvalProcessingAtom)
			expect(processing.operation).toBe("approve")
		})

		it("should track processing timestamp", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			store.set(startApprovalProcessingAtom, "reject")

			const processing = store.get(approvalProcessingAtom)
			expect(processing.processingTs).toBe(1000)
		})

		it("should clear processing state on completion", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			store.set(startApprovalProcessingAtom, "approve")
			store.set(completeApprovalProcessingAtom)

			const processing = store.get(approvalProcessingAtom)
			expect(processing.isProcessing).toBe(false)
			expect(processing.processingTs).toBeUndefined()
			expect(processing.operation).toBeUndefined()
		})
	})

	describe("Edge Cases", () => {
		it("should handle clearing when no pending approval exists", () => {
			expect(store.get(pendingApprovalAtom)).toBeNull()

			// Should not throw
			store.set(clearPendingApprovalAtom)
			expect(store.get(pendingApprovalAtom)).toBeNull()
		})

		it("should handle starting processing when no pending approval", () => {
			expect(store.get(pendingApprovalAtom)).toBeNull()

			const started = store.set(startApprovalProcessingAtom, "approve")
			expect(started).toBe(false)
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(false)
		})

		it("should handle completing processing when not processing", () => {
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(false)

			// Should not throw
			store.set(completeApprovalProcessingAtom)
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(false)
		})

		it("should clear processing state when clearing pending approval with matching timestamp", () => {
			const message = createMockMessage(1000)

			store.set(setPendingApprovalAtom, message)
			store.set(startApprovalProcessingAtom, "approve")

			// Clear pending approval
			store.set(clearPendingApprovalAtom)

			// Processing state should also be cleared since timestamps match
			expect(store.get(approvalProcessingAtom).isProcessing).toBe(false)
		})
	})
})
