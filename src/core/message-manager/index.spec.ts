import { MessageManager } from "./index"
import * as condenseModule from "../condense"

describe("MessageManager", () => {
	let mockTask: any
	let manager: MessageManager
	let cleanupAfterTruncationSpy: any

	beforeEach(() => {
		mockTask = {
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
		}
		manager = new MessageManager(mockTask)

		// Mock cleanupAfterTruncation to track calls and return input by default
		cleanupAfterTruncationSpy = vi.spyOn(condenseModule, "cleanupAfterTruncation")
		cleanupAfterTruncationSpy.mockImplementation((messages: any[]) => messages)
	})

	afterEach(() => {
		cleanupAfterTruncationSpy.mockRestore()
	})

	describe("Basic rewind operations", () => {
		it("should remove messages at and after the target timestamp", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "user", text: "Second" },
				{ ts: 400, say: "assistant", text: "Response 2" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 200, role: "assistant", content: [{ type: "text", text: "Response" }] },
				{ ts: 300, role: "user", content: [{ type: "text", text: "Second" }] },
				{ ts: 400, role: "assistant", content: [{ type: "text", text: "Response 2" }] },
			]

			await manager.rewindToTimestamp(300)

			// Should keep messages before ts=300
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
			])

			// Should keep API messages before ts=300
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(2)
			expect(apiCall[0].ts).toBe(100)
			expect(apiCall[1].ts).toBe(200)
		})

		it("should keep target message when includeTargetMessage is true", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "user", text: "Second" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 200, role: "assistant", content: [{ type: "text", text: "Response" }] },
				{ ts: 300, role: "user", content: [{ type: "text", text: "Second" }] },
			]

			await manager.rewindToTimestamp(300, { includeTargetMessage: true })

			// Should keep messages up to and including ts=300 in clineMessages
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "user", text: "Second" },
			])

			// API history uses ts < cutoffTs, so excludes the message at ts=300
			// This is correct for edit scenarios - keep UI message but truncate API before it
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(2)
			expect(apiCall[0].ts).toBe(100)
			expect(apiCall[1].ts).toBe(200)
		})

		it("should throw error when timestamp not found", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
			]

			await expect(manager.rewindToTimestamp(999)).rejects.toThrow(
				"Message with timestamp 999 not found in clineMessages",
			)
		})

		it("should remove messages at and after the target index", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "user", text: "Second" },
				{ ts: 400, say: "assistant", text: "Response 2" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 200, role: "assistant", content: [{ type: "text", text: "Response" }] },
				{ ts: 300, role: "user", content: [{ type: "text", text: "Second" }] },
				{ ts: 400, role: "assistant", content: [{ type: "text", text: "Response 2" }] },
			]

			await manager.rewindToIndex(2)

			// Should keep messages [0, 2) - index 0 and 1
			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
			])

			// Should keep API messages before ts=300
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(2)
		})
	})

	describe("Condense handling", () => {
		it("should preserve Summary when condense_context is preserved", async () => {
			const condenseId = "summary-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
				{ ts: 400, say: "user", text: "After condense" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 200,
					role: "assistant",
					content: [{ type: "text", text: "Response" }],
					condenseParent: condenseId,
				},
				{
					ts: 299,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
				{ ts: 400, role: "user", content: [{ type: "text", text: "After condense" }] },
			]

			// Rewind to ts=400, which preserves condense_context at ts=300
			await manager.rewindToTimestamp(400)

			// Summary should still exist
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasSummary = apiCall.some((m: any) => m.isSummary && m.condenseId === condenseId)
			expect(hasSummary).toBe(true)
		})

		it("should remove Summary when condense_context is removed", async () => {
			const condenseId = "summary-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "user", text: "Second" },
				{ ts: 400, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
				{ ts: 500, say: "user", text: "Third" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 200,
					role: "assistant",
					content: [{ type: "text", text: "Response" }],
					condenseParent: condenseId,
				},
				{
					ts: 299,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
				{ ts: 300, role: "user", content: [{ type: "text", text: "Second" }] },
				{ ts: 500, role: "user", content: [{ type: "text", text: "Third" }] },
			]

			// Rewind to ts=300, which removes condense_context at ts=400
			await manager.rewindToTimestamp(300)

			// Summary should be removed
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasSummary = apiCall.some((m: any) => m.isSummary)
			expect(hasSummary).toBe(false)
		})

		it("should clear orphaned condenseParent tags via cleanup", async () => {
			const condenseId = "summary-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 150,
					role: "assistant",
					content: [{ type: "text", text: "Response" }],
					condenseParent: condenseId,
				},
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
			]

			// Rewind to ts=100, which removes condense_context
			await manager.rewindToTimestamp(100)

			// cleanupAfterTruncation should be called to remove orphaned tags
			expect(cleanupAfterTruncationSpy).toHaveBeenCalled()
		})

		it("should handle multiple condense_context removals", async () => {
			const condenseId1 = "summary-1"
			const condenseId2 = "summary-2"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{
					ts: 200,
					say: "condense_context",
					contextCondense: { condenseId: condenseId1, summary: "Summary 1" },
				},
				{ ts: 300, say: "user", text: "Second" },
				{
					ts: 400,
					say: "condense_context",
					contextCondense: { condenseId: condenseId2, summary: "Summary 2" },
				},
				{ ts: 500, say: "user", text: "Third" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "Summary 1" }],
					isSummary: true,
					condenseId: condenseId1,
				},
				{ ts: 300, role: "user", content: [{ type: "text", text: "Second" }] },
				{
					ts: 399,
					role: "assistant",
					content: [{ type: "text", text: "Summary 2" }],
					isSummary: true,
					condenseId: condenseId2,
				},
				{ ts: 500, role: "user", content: [{ type: "text", text: "Third" }] },
			]

			// Rewind to ts=200, which removes both condense_context messages
			await manager.rewindToTimestamp(200)

			// Both summaries should be removed
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasSummary1 = apiCall.some((m: any) => m.condenseId === condenseId1)
			const hasSummary2 = apiCall.some((m: any) => m.condenseId === condenseId2)
			expect(hasSummary1).toBe(false)
			expect(hasSummary2).toBe(false)
		})
	})

	describe("Truncation handling", () => {
		it("should preserve truncation marker when sliding_window_truncation is preserved", async () => {
			const truncationId = "trunc-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "sliding_window_truncation", contextTruncation: { truncationId, reason: "window" } },
				{ ts: 300, say: "user", text: "After truncation" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }], truncationParent: truncationId },
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId,
				},
				{ ts: 300, role: "user", content: [{ type: "text", text: "After truncation" }] },
			]

			// Rewind to ts=300, which preserves sliding_window_truncation at ts=200
			await manager.rewindToTimestamp(300)

			// Truncation marker should still exist
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasMarker = apiCall.some((m: any) => m.isTruncationMarker && m.truncationId === truncationId)
			expect(hasMarker).toBe(true)
		})

		it("should remove truncation marker when sliding_window_truncation is removed", async () => {
			const truncationId = "trunc-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "user", text: "Second" },
				{ ts: 300, say: "sliding_window_truncation", contextTruncation: { truncationId, reason: "window" } },
				{ ts: 400, say: "user", text: "Third" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }], truncationParent: truncationId },
				{ ts: 200, role: "user", content: [{ type: "text", text: "Second" }] },
				{
					ts: 299,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId,
				},
				{ ts: 400, role: "user", content: [{ type: "text", text: "Third" }] },
			]

			// Rewind to ts=200, which removes sliding_window_truncation at ts=300
			await manager.rewindToTimestamp(200)

			// Truncation marker should be removed
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasMarker = apiCall.some((m: any) => m.isTruncationMarker)
			expect(hasMarker).toBe(false)
		})

		it("should clear orphaned truncationParent tags via cleanup", async () => {
			const truncationId = "trunc-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "sliding_window_truncation", contextTruncation: { truncationId, reason: "window" } },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }], truncationParent: truncationId },
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId,
				},
			]

			// Rewind to ts=100, which removes sliding_window_truncation
			await manager.rewindToTimestamp(100)

			// cleanupAfterTruncation should be called to remove orphaned tags
			expect(cleanupAfterTruncationSpy).toHaveBeenCalled()
		})

		it("should handle multiple truncation removals", async () => {
			const truncationId1 = "trunc-1"
			const truncationId2 = "trunc-2"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{
					ts: 200,
					say: "sliding_window_truncation",
					contextTruncation: { truncationId: truncationId1, reason: "window" },
				},
				{ ts: 300, say: "user", text: "Second" },
				{
					ts: 400,
					say: "sliding_window_truncation",
					contextTruncation: { truncationId: truncationId2, reason: "window" },
				},
				{ ts: 500, say: "user", text: "Third" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId: truncationId1,
				},
				{ ts: 300, role: "user", content: [{ type: "text", text: "Second" }] },
				{
					ts: 399,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId: truncationId2,
				},
				{ ts: 500, role: "user", content: [{ type: "text", text: "Third" }] },
			]

			// Rewind to ts=200, which removes both truncation messages
			await manager.rewindToTimestamp(200)

			// Both markers should be removed
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasMarker1 = apiCall.some((m: any) => m.truncationId === truncationId1)
			const hasMarker2 = apiCall.some((m: any) => m.truncationId === truncationId2)
			expect(hasMarker1).toBe(false)
			expect(hasMarker2).toBe(false)
		})
	})

	describe("Checkpoint scenarios", () => {
		it("should preserve Summary when checkpoint restore is BEFORE condense", async () => {
			const condenseId = "summary-abc"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "Task" },
				{ ts: 500, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
				{ ts: 600, say: "checkpoint_saved", text: "checkpoint-hash" },
				{ ts: 700, say: "user", text: "After checkpoint" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "Task" }] },
				{
					ts: 200,
					role: "assistant",
					content: [{ type: "text", text: "Response 1" }],
					condenseParent: condenseId,
				},
				{
					ts: 499,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
				{ ts: 700, role: "user", content: [{ type: "text", text: "After checkpoint" }] },
			]

			// Restore checkpoint at ts=600 (like checkpoint restore does)
			await manager.rewindToTimestamp(600, { includeTargetMessage: true })

			// Since condense_context (ts=500) is BEFORE checkpoint, it should be preserved
			const clineCall = mockTask.overwriteClineMessages.mock.calls[0][0]
			const hasCondenseContext = clineCall.some((m: any) => m.say === "condense_context")
			expect(hasCondenseContext).toBe(true)

			// And the Summary should still exist
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasSummary = apiCall.some((m: any) => m.isSummary)
			expect(hasSummary).toBe(true)
		})

		it("should remove Summary when checkpoint restore is AFTER condense", async () => {
			const condenseId = "summary-xyz"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "Task" },
				{ ts: 200, say: "checkpoint_saved", text: "checkpoint-hash" },
				{ ts: 300, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
				{ ts: 400, say: "user", text: "After condense" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "Task" }] },
				{
					ts: 150,
					role: "assistant",
					content: [{ type: "text", text: "Response" }],
					condenseParent: condenseId,
				},
				{
					ts: 299,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
				{ ts: 400, role: "user", content: [{ type: "text", text: "After condense" }] },
			]

			// Restore checkpoint at ts=200 (before the condense happened)
			await manager.rewindToTimestamp(200, { includeTargetMessage: true })

			// condense_context (ts=300) is AFTER checkpoint, so it should be removed
			const clineCall = mockTask.overwriteClineMessages.mock.calls[0][0]
			const hasCondenseContext = clineCall.some((m: any) => m.say === "condense_context")
			expect(hasCondenseContext).toBe(false)

			// And the Summary should be removed too
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasSummary = apiCall.some((m: any) => m.isSummary)
			expect(hasSummary).toBe(false)
		})

		it("should preserve truncation marker when checkpoint restore is BEFORE truncation", async () => {
			const truncationId = "trunc-abc"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "Task" },
				{ ts: 500, say: "sliding_window_truncation", contextTruncation: { truncationId, reason: "window" } },
				{ ts: 600, say: "checkpoint_saved", text: "checkpoint-hash" },
				{ ts: 700, say: "user", text: "After checkpoint" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "Task" }], truncationParent: truncationId },
				{
					ts: 499,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId,
				},
				{ ts: 700, role: "user", content: [{ type: "text", text: "After checkpoint" }] },
			]

			// Restore checkpoint at ts=600
			await manager.rewindToTimestamp(600, { includeTargetMessage: true })

			// Truncation should be preserved
			const clineCall = mockTask.overwriteClineMessages.mock.calls[0][0]
			const hasTruncation = clineCall.some((m: any) => m.say === "sliding_window_truncation")
			expect(hasTruncation).toBe(true)

			// Marker should still exist
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasMarker = apiCall.some((m: any) => m.isTruncationMarker)
			expect(hasMarker).toBe(true)
		})

		it("should remove truncation marker when checkpoint restore is AFTER truncation", async () => {
			const truncationId = "trunc-xyz"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "Task" },
				{ ts: 200, say: "checkpoint_saved", text: "checkpoint-hash" },
				{ ts: 300, say: "sliding_window_truncation", contextTruncation: { truncationId, reason: "window" } },
				{ ts: 400, say: "user", text: "After truncation" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "Task" }], truncationParent: truncationId },
				{
					ts: 299,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId,
				},
				{ ts: 400, role: "user", content: [{ type: "text", text: "After truncation" }] },
			]

			// Restore checkpoint at ts=200 (before truncation happened)
			await manager.rewindToTimestamp(200, { includeTargetMessage: true })

			// Truncation should be removed
			const clineCall = mockTask.overwriteClineMessages.mock.calls[0][0]
			const hasTruncation = clineCall.some((m: any) => m.say === "sliding_window_truncation")
			expect(hasTruncation).toBe(false)

			// Marker should be removed
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasMarker = apiCall.some((m: any) => m.isTruncationMarker)
			expect(hasMarker).toBe(false)
		})
	})

	describe("Skip cleanup option", () => {
		it("should NOT call cleanupAfterTruncation when skipCleanup is true", async () => {
			const condenseId = "summary-123"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 150,
					role: "assistant",
					content: [{ type: "text", text: "Response" }],
					condenseParent: condenseId,
				},
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
			]

			// Rewind with skipCleanup
			await manager.rewindToTimestamp(100, { skipCleanup: true })

			// cleanupAfterTruncation should NOT be called
			expect(cleanupAfterTruncationSpy).not.toHaveBeenCalled()
		})

		it("should call cleanupAfterTruncation by default", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "user", text: "Second" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 200, role: "user", content: [{ type: "text", text: "Second" }] },
			]

			// Rewind without options (skipCleanup defaults to false)
			await manager.rewindToTimestamp(100)

			// cleanupAfterTruncation should be called
			expect(cleanupAfterTruncationSpy).toHaveBeenCalled()
		})

		it("should call cleanupAfterTruncation when skipCleanup is explicitly false", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "user", text: "Second" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 200, role: "user", content: [{ type: "text", text: "Second" }] },
			]

			// Rewind with skipCleanup explicitly false
			await manager.rewindToTimestamp(100, { skipCleanup: false })

			// cleanupAfterTruncation should be called
			expect(cleanupAfterTruncationSpy).toHaveBeenCalled()
		})
	})

	describe("Combined scenarios", () => {
		it("should handle both condense and truncation removal in the same rewind", async () => {
			const condenseId = "summary-123"
			const truncationId = "trunc-456"

			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "condense_context", contextCondense: { condenseId, summary: "Summary" } },
				{ ts: 300, say: "sliding_window_truncation", contextTruncation: { truncationId, reason: "window" } },
				{ ts: 400, say: "user", text: "After both" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{
					ts: 199,
					role: "assistant",
					content: [{ type: "text", text: "Summary" }],
					isSummary: true,
					condenseId,
				},
				{
					ts: 299,
					role: "assistant",
					content: [{ type: "text", text: "..." }],
					isTruncationMarker: true,
					truncationId,
				},
				{ ts: 400, role: "user", content: [{ type: "text", text: "After both" }] },
			]

			// Rewind to ts=100, which removes both
			await manager.rewindToTimestamp(100)

			// Both Summary and marker should be removed
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			const hasSummary = apiCall.some((m: any) => m.isSummary)
			const hasMarker = apiCall.some((m: any) => m.isTruncationMarker)
			expect(hasSummary).toBe(false)
			expect(hasMarker).toBe(false)
		})

		it("should handle empty clineMessages array", async () => {
			mockTask.clineMessages = []
			mockTask.apiConversationHistory = []

			await manager.rewindToIndex(0)

			expect(mockTask.overwriteClineMessages).toHaveBeenCalledWith([])
			// API history write is skipped when nothing changed (optimization)
			expect(mockTask.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})

		it("should handle messages without timestamps in API history", async () => {
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "user", text: "Second" },
			]

			mockTask.apiConversationHistory = [
				{ role: "system", content: [{ type: "text", text: "System message" }] }, // No ts
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 200, role: "user", content: [{ type: "text", text: "Second" }] },
			]

			await manager.rewindToTimestamp(100)

			// Should keep system message (no ts) and message at ts=100
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(1)
			expect(apiCall[0].role).toBe("system")
		})
	})

	describe("Race condition handling", () => {
		it("should preserve assistant message when clineMessage timestamp is earlier due to async execution", async () => {
			// This test reproduces the bug where deleting a user_feedback clineMessage
			// incorrectly removes an assistant API message that was added AFTER the
			// clineMessage (due to async tool execution during streaming).
			//
			// Timeline (race condition scenario):
			// - T1 (100): clineMessage "user_feedback" created during tool execution
			// - T2 (200): assistant API message added when stream completes
			// - T3 (300): user API message (tool_result) added after pWaitFor
			//
			// When deleting the clineMessage at T1, we should:
			// - Keep the assistant message at T2
			// - Remove the user message at T3

			mockTask.clineMessages = [
				{ ts: 50, say: "user", text: "Initial request" },
				{ ts: 100, say: "user_feedback", text: "tell me a joke 3" }, // Race: created BEFORE assistant API msg
			]

			mockTask.apiConversationHistory = [
				{ ts: 50, role: "user", content: [{ type: "text", text: "Initial request" }] },
				{
					ts: 200, // Race: added AFTER clineMessage at ts=100
					role: "assistant",
					content: [{ type: "tool_use", id: "tool_1", name: "attempt_completion", input: {} }],
				},
				{
					ts: 300,
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "tool_1", content: "tell me a joke 3" }],
				},
			]

			// Delete the user_feedback clineMessage at ts=100
			await manager.rewindToTimestamp(100)

			// The fix ensures we find the first API user message at or after cutoff (ts=300)
			// and use that as the actual cutoff, preserving the assistant message (ts=200)
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(2)
			expect(apiCall[0].ts).toBe(50) // Initial user message preserved
			expect(apiCall[1].ts).toBe(200) // Assistant message preserved (was incorrectly removed before fix)
			expect(apiCall[1].role).toBe("assistant")
		})

		it("should handle normal case where timestamps are properly ordered", async () => {
			// Normal case: clineMessage timestamp aligns with API message timestamp
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "user_feedback", text: "Feedback" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 150, role: "assistant", content: [{ type: "text", text: "Response" }] },
				{ ts: 200, role: "user", content: [{ type: "text", text: "Feedback" }] },
			]

			await manager.rewindToTimestamp(200)

			// Should keep messages before the user message at ts=200
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(2)
			expect(apiCall[0].ts).toBe(100)
			expect(apiCall[1].ts).toBe(150)
		})

		it("should fall back to original cutoff when no user message found at or after cutoff", async () => {
			// Edge case: no API user message at or after the cutoff timestamp
			mockTask.clineMessages = [
				{ ts: 100, say: "user", text: "First" },
				{ ts: 200, say: "assistant", text: "Response" },
				{ ts: 300, say: "assistant", text: "Another response" },
			]

			mockTask.apiConversationHistory = [
				{ ts: 100, role: "user", content: [{ type: "text", text: "First" }] },
				{ ts: 150, role: "assistant", content: [{ type: "text", text: "Response" }] },
				{ ts: 250, role: "assistant", content: [{ type: "text", text: "Another response" }] },
				// No user message at or after ts=200
			]

			await manager.rewindToTimestamp(200)

			// Falls back to original behavior: keep messages with ts < 200
			// This removes the assistant message at ts=250
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(2)
			expect(apiCall[0].ts).toBe(100)
			expect(apiCall[1].ts).toBe(150)
		})

		it("should handle multiple assistant messages before the user message in race condition", async () => {
			// Complex race scenario: multiple assistant messages added before user message
			mockTask.clineMessages = [
				{ ts: 50, say: "user", text: "Initial" },
				{ ts: 100, say: "user_feedback", text: "Feedback" }, // Race condition
			]

			mockTask.apiConversationHistory = [
				{ ts: 50, role: "user", content: [{ type: "text", text: "Initial" }] },
				{ ts: 150, role: "assistant", content: [{ type: "text", text: "First assistant msg" }] }, // After clineMessage
				{ ts: 200, role: "assistant", content: [{ type: "text", text: "Second assistant msg" }] }, // After clineMessage
				{ ts: 250, role: "user", content: [{ type: "text", text: "Feedback" }] },
			]

			await manager.rewindToTimestamp(100)

			// Should preserve both assistant messages (ts=150, ts=200) because the first
			// user message at or after cutoff is at ts=250
			const apiCall = mockTask.overwriteApiConversationHistory.mock.calls[0][0]
			expect(apiCall).toHaveLength(3)
			expect(apiCall[0].ts).toBe(50)
			expect(apiCall[1].ts).toBe(150)
			expect(apiCall[1].role).toBe("assistant")
			expect(apiCall[2].ts).toBe(200)
			expect(apiCall[2].role).toBe("assistant")
		})
	})
})
