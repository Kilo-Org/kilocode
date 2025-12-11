import { describe, it, expect, beforeEach, vi } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"
import { MessageManager } from "../../message-manager"

// Mock the saveTaskMessages function
vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))

// Mock the i18n module
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
	changeLanguage: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
	Uri: {
		parse: vi.fn((str) => ({ toString: () => str })),
		file: vi.fn((path) => ({ fsPath: path })),
	},
	env: {
		openExternal: vi.fn(),
		clipboard: {
			writeText: vi.fn(),
		},
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

describe("webviewMessageHandler delete functionality", () => {
	let provider: any
	let getCurrentTaskMock: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Create mock task
		getCurrentTaskMock = {
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(async () => {}),
			overwriteApiConversationHistory: vi.fn(async () => {}),
			taskId: "test-task-id",
		}
		// Add messageManager using a real MessageManager instance (must be added after object creation
		// to avoid circular reference issues with 'this')
		getCurrentTaskMock.messageManager = new MessageManager(getCurrentTaskMock as any)

		// Create mock provider
		provider = {
			getCurrentTask: vi.fn(() => getCurrentTaskMock),
			postMessageToWebview: vi.fn(),
			contextProxy: {
				getValue: vi.fn(),
				setValue: vi.fn(async () => {}),
				globalStorageUri: { fsPath: "/test/path" },
			},
			log: vi.fn(),
			cwd: "/test/cwd",
		}
	})

	describe("handleDeleteMessageConfirm", () => {
		it("should handle deletion when apiConversationHistoryIndex is -1 (message not in API history)", async () => {
			// Setup test data with a user message and assistant response
			const userMessageTs = 1000
			const assistantMessageTs = 1001

			getCurrentTaskMock.clineMessages = [
				{ ts: userMessageTs, say: "user", text: "Hello" },
				{ ts: assistantMessageTs, say: "assistant", text: "Hi there" },
			]

			// API history has the assistant message but not the user message
			// This simulates the case where the user message wasn't in API history
			getCurrentTaskMock.apiConversationHistory = [
				{ ts: assistantMessageTs, role: "assistant", content: { type: "text", text: "Hi there" } },
				{
					ts: 1002,
					role: "assistant",
					content: { type: "text", text: "attempt_completion" },
					name: "attempt_completion",
				},
			]

			// Call delete for the user message
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: userMessageTs,
			})

			// Verify that clineMessages was truncated at the correct index
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([])

			// When message is not found in API history (index is -1),
			// API history should be truncated from the first API message at/after the deleted timestamp (fallback)
			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([])
		})

		it("should handle deletion when exact apiConversationHistoryIndex is found", async () => {
			// Setup test data where message exists in both arrays
			const messageTs = 1000

			getCurrentTaskMock.clineMessages = [
				{ ts: 900, say: "user", text: "Previous message" },
				{ ts: messageTs, say: "user", text: "Delete this" },
				{ ts: 1100, say: "assistant", text: "Response" },
			]

			getCurrentTaskMock.apiConversationHistory = [
				{ ts: 900, role: "user", content: { type: "text", text: "Previous message" } },
				{ ts: messageTs, role: "user", content: { type: "text", text: "Delete this" } },
				{ ts: 1100, role: "assistant", content: { type: "text", text: "Response" } },
			]

			// Call delete
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: messageTs,
			})

			// Verify truncation at correct indices
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 900, say: "user", text: "Previous message" },
			])

			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 900, role: "user", content: { type: "text", text: "Previous message" } },
			])
		})

		it("should handle deletion when message not found in clineMessages", async () => {
			getCurrentTaskMock.clineMessages = [{ ts: 1000, say: "user", text: "Some message" }]

			getCurrentTaskMock.apiConversationHistory = []

			// Call delete with non-existent timestamp
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: 9999,
			})

			// Verify error message was shown (expecting translation key since t() is mocked to return the key)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.message.message_not_found")

			// Verify no truncation occurred
			expect(getCurrentTaskMock.overwriteClineMessages).not.toHaveBeenCalled()
			expect(getCurrentTaskMock.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})

		it("should handle deletion with attempt_completion in API history", async () => {
			// Setup test data with attempt_completion
			const userMessageTs = 1000
			const attemptCompletionTs = 1001

			getCurrentTaskMock.clineMessages = [
				{ ts: userMessageTs, say: "user", text: "Fix the bug" },
				{ ts: attemptCompletionTs, say: "assistant", text: "I've fixed the bug" },
			]

			// API history has attempt_completion but user message is missing
			getCurrentTaskMock.apiConversationHistory = [
				{
					ts: attemptCompletionTs,
					role: "assistant",
					content: {
						type: "text",
						text: "I've fixed the bug in the code",
					},
					name: "attempt_completion",
				},
				{
					ts: 1002,
					role: "user",
					content: { type: "text", text: "Looks good, but..." },
				},
			]

			// Call delete for the user message
			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: userMessageTs,
			})

			// Verify that clineMessages was truncated
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([])

			// API history should be truncated from first message at/after deleted timestamp (fallback)
			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([])
		})

		it("should preserve messages before the deleted one", async () => {
			const messageTs = 2000

			getCurrentTaskMock.clineMessages = [
				{ ts: 1000, say: "user", text: "First message" },
				{ ts: 1500, say: "assistant", text: "First response" },
				{ ts: messageTs, say: "user", text: "Delete this" },
				{ ts: 2500, say: "assistant", text: "Response to delete" },
			]

			getCurrentTaskMock.apiConversationHistory = [
				{ ts: 1000, role: "user", content: { type: "text", text: "First message" } },
				{ ts: 1500, role: "assistant", content: { type: "text", text: "First response" } },
				{ ts: messageTs, role: "user", content: { type: "text", text: "Delete this" } },
				{ ts: 2500, role: "assistant", content: { type: "text", text: "Response to delete" } },
			]

			await webviewMessageHandler(provider, {
				type: "deleteMessageConfirm",
				messageTs: messageTs,
			})

			// Should preserve messages before the deleted one
			expect(getCurrentTaskMock.overwriteClineMessages).toHaveBeenCalledWith([
				{ ts: 1000, say: "user", text: "First message" },
				{ ts: 1500, say: "assistant", text: "First response" },
			])

			// API history should be truncated at the exact index
			expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalledWith([
				{ ts: 1000, role: "user", content: { type: "text", text: "First message" } },
				{ ts: 1500, role: "assistant", content: { type: "text", text: "First response" } },
			])
		})

		describe("condense preservation behavior", () => {
			it("should preserve summary and condensed messages when deleting after the summary", async () => {
				// Design: Rewind/delete preserves summaries that were created BEFORE the rewind point.
				// Only summaries removed by truncation have their associated condenseParent tags cleared.
				const condenseId = "summary-abc"

				getCurrentTaskMock.clineMessages = [
					{ ts: 100, say: "user", text: "First message" },
					{ ts: 200, say: "assistant", text: "Response 1" },
					{ ts: 300, say: "user", text: "Second message" },
					{ ts: 799, say: "assistant", text: "Summary" },
					{ ts: 800, say: "assistant", text: "Kept message 1" },
					{ ts: 900, say: "user", text: "Kept message 2" },
					{ ts: 1000, say: "assistant", text: "Kept message 3" },
				]

				// API history after condense: msg1, msg2(tagged), msg3(tagged), summary, kept1, kept2, kept3
				getCurrentTaskMock.apiConversationHistory = [
					{ ts: 100, role: "user", content: "First message" },
					{ ts: 200, role: "assistant", content: "Response 1", condenseParent: condenseId },
					{ ts: 300, role: "user", content: "Second message", condenseParent: condenseId },
					{ ts: 799, role: "assistant", content: "Summary", isSummary: true, condenseId },
					{ ts: 800, role: "assistant", content: "Kept message 1" },
					{ ts: 900, role: "user", content: "Kept message 2" },
					{ ts: 1000, role: "assistant", content: "Kept message 3" },
				]

				// Delete kept message 2 (ts=900) - summary is BEFORE truncation point so should be preserved
				await webviewMessageHandler(provider, {
					type: "deleteMessageConfirm",
					messageTs: 900,
				})

				expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalled()
				const result = getCurrentTaskMock.overwriteApiConversationHistory.mock.calls[0][0]

				// Summary should be PRESERVED, condensed messages should KEEP their tags
				// Expected: [msg1, msg2(tagged), msg3(tagged), summary, kept1]
				expect(result.length).toBe(5)
				expect(result[0].content).toBe("First message")
				expect(result[1].content).toBe("Response 1")
				expect(result[1].condenseParent).toBe(condenseId) // Tag preserved
				expect(result[2].content).toBe("Second message")
				expect(result[2].condenseParent).toBe(condenseId) // Tag preserved
				expect(result[3].content).toBe("Summary")
				expect(result[3].isSummary).toBe(true) // Summary preserved
				expect(result[4].content).toBe("Kept message 1")
			})

			it("should restore condensed messages when summary is removed by truncation", async () => {
				// Scenario: Condensed messages exist, user deletes in a way that removes the summary
				// The orphaned condenseParent tags should be cleared
				const condenseId = "summary-xyz"

				getCurrentTaskMock.clineMessages = [
					{ ts: 100, say: "user", text: "Task start" },
					{ ts: 200, say: "assistant", text: "Response 1" },
					{ ts: 300, say: "user", text: "Message 2" },
					{ ts: 999, say: "assistant", text: "Summary displayed" },
					{ ts: 1000, say: "user", text: "First kept" },
				]

				// API history with condensed messages and summary
				getCurrentTaskMock.apiConversationHistory = [
					{ ts: 100, role: "user", content: "Task start" },
					{ ts: 200, role: "assistant", content: "Response 1", condenseParent: condenseId },
					{ ts: 300, role: "user", content: "Message 2", condenseParent: condenseId },
					{ ts: 999, role: "assistant", content: "Summary", isSummary: true, condenseId },
					{ ts: 1000, role: "user", content: "First kept" },
				]

				// Delete "Message 2" (ts=300) - this removes summary too, so orphaned tags should be cleared
				await webviewMessageHandler(provider, {
					type: "deleteMessageConfirm",
					messageTs: 300,
				})

				expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalled()
				const result = getCurrentTaskMock.overwriteApiConversationHistory.mock.calls[0][0]

				// Summary was removed, so orphaned tags should be cleared
				expect(result.length).toBe(2)
				expect(result[0].content).toBe("Task start")
				expect(result[1].content).toBe("Response 1")
				expect(result[1].condenseParent).toBeUndefined() // Tag cleared since summary is gone
			})

			it("should preserve first condense but undo second when rewinding past second condense only", async () => {
				// Scenario: Double condense, user deletes a message that removes the second summary
				// but keeps the first summary. First condense should remain intact.
				const condenseId1 = "summary-first"
				const condenseId2 = "summary-second"

				getCurrentTaskMock.clineMessages = [
					{ ts: 100, say: "user", text: "First message" },
					{ ts: 799, say: "assistant", text: "Summary1" },
					{ ts: 1799, say: "assistant", text: "Summary2" },
					{ ts: 1800, say: "user", text: "Kept1" },
					{ ts: 1900, say: "assistant", text: "Kept2" },
					{ ts: 2000, say: "user", text: "To delete" },
				]

				getCurrentTaskMock.apiConversationHistory = [
					{ ts: 100, role: "user", content: "First message" },
					// Messages from first condense (tagged with condenseId1)
					{ ts: 200, role: "assistant", content: "Msg2", condenseParent: condenseId1 },
					{ ts: 300, role: "user", content: "Msg3", condenseParent: condenseId1 },
					// First summary - ALSO tagged with condenseId2 from second condense
					{
						ts: 799,
						role: "assistant",
						content: "Summary1",
						isSummary: true,
						condenseId: condenseId1,
						condenseParent: condenseId2,
					},
					// Messages from second condense (tagged with condenseId2)
					{ ts: 1000, role: "assistant", content: "Msg after summary1", condenseParent: condenseId2 },
					{ ts: 1100, role: "user", content: "More msgs", condenseParent: condenseId2 },
					// Second summary
					{ ts: 1799, role: "assistant", content: "Summary2", isSummary: true, condenseId: condenseId2 },
					// Kept messages
					{ ts: 1800, role: "user", content: "Kept1" },
					{ ts: 1900, role: "assistant", content: "Kept2" },
					{ ts: 2000, role: "user", content: "To delete" },
				]

				// Delete "Kept2" (ts=1900) - summary2 is BEFORE truncation, so it's preserved
				await webviewMessageHandler(provider, {
					type: "deleteMessageConfirm",
					messageTs: 1900,
				})

				expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalled()
				const result = getCurrentTaskMock.overwriteApiConversationHistory.mock.calls[0][0]

				// Both summaries should be preserved since they're before the truncation point
				const summaries = result.filter((msg: any) => msg.isSummary)
				expect(summaries.length).toBe(2)

				// Verify tags are preserved
				const summary1 = result.find((msg: any) => msg.content === "Summary1")
				expect(summary1.condenseParent).toBe(condenseId2) // Still tagged
			})

			it("should use timestamp-based truncation when multiple messages share same timestamp", async () => {
				// When multiple messages share the same timestamp, timestamp-based truncation
				// removes ALL messages at or after that timestamp. This is different from
				// index-based truncation which would preserve earlier array indices.
				const sharedTs = 1000

				getCurrentTaskMock.clineMessages = [
					{ ts: 900, say: "user", text: "Previous message" },
					{ ts: sharedTs, say: "user", text: "First kept message" },
					{ ts: 1100, say: "assistant", text: "Response" },
				]

				// Summary and regular message share timestamp (edge case)
				getCurrentTaskMock.apiConversationHistory = [
					{ ts: 900, role: "user", content: "Previous message" },
					{ ts: sharedTs, role: "assistant", content: "Summary", isSummary: true, condenseId: "abc" },
					{ ts: sharedTs, role: "user", content: "First kept message" },
					{ ts: 1100, role: "assistant", content: "Response" },
				]

				// Delete at shared timestamp - MessageManager uses ts < cutoffTs, so ALL
				// messages at ts=1000 are removed (including the Summary)
				await webviewMessageHandler(provider, {
					type: "deleteMessageConfirm",
					messageTs: sharedTs,
				})

				expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalled()
				const result = getCurrentTaskMock.overwriteApiConversationHistory.mock.calls[0][0]

				// Timestamp-based truncation keeps only messages with ts < 1000
				// Both the Summary (ts=1000) and non-summary (ts=1000) are removed
				expect(result.length).toBe(1)
				expect(result[0].content).toBe("Previous message")
			})

			it("should remove Summary when its condense_context clineMessage is deleted", async () => {
				// Scenario: Summary has timestamp BEFORE the deletion point (so it survives truncation),
				// BUT the condense_context UI message has timestamp AFTER the deletion point (so it gets removed).
				// The fix links them via condenseId so the Summary is explicitly removed.
				const condenseId = "summary-sync-test"

				getCurrentTaskMock.clineMessages = [
					{ ts: 100, say: "user", text: "Task start" },
					{ ts: 200, say: "assistant", text: "Response 1" },
					{ ts: 300, say: "user", text: "Message to delete this and after" },
					{ ts: 400, say: "assistant", text: "Response 2" },
					// condense_context is created AFTER the condense operation
					{ ts: 500, say: "condense_context", contextCondense: { condenseId, summary: "Summary text" } },
					{ ts: 600, say: "user", text: "Post-condense message" },
				]

				// Summary has ts=299 (before first kept message), so it would survive basic truncation
				// But since condense_context (ts=500) is being removed, Summary should be removed too
				getCurrentTaskMock.apiConversationHistory = [
					{ ts: 100, role: "user", content: "Task start" },
					{ ts: 200, role: "assistant", content: "Response 1", condenseParent: condenseId },
					// Summary timestamp is BEFORE the kept messages (this is the bug scenario)
					{ ts: 299, role: "assistant", content: "Summary text", isSummary: true, condenseId },
					{ ts: 300, role: "user", content: "Message to delete this and after" },
					{ ts: 400, role: "assistant", content: "Response 2" },
					{ ts: 600, role: "user", content: "Post-condense message" },
				]

				// Delete at ts=300 - this removes condense_context (ts=500), so Summary should be removed too
				await webviewMessageHandler(provider, {
					type: "deleteMessageConfirm",
					messageTs: 300,
				})

				expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalled()
				const result = getCurrentTaskMock.overwriteApiConversationHistory.mock.calls[0][0]

				// Summary should be REMOVED even though its timestamp (299) is before truncation point (300)
				// because its corresponding condense_context message is being removed
				expect(result.length).toBe(2)
				expect(result[0].content).toBe("Task start")
				expect(result[1].content).toBe("Response 1")
				// condenseParent should be cleared since the Summary is gone
				expect(result[1].condenseParent).toBeUndefined()
			})

			it("should preserve first Summary when only second condense_context is deleted (nested condense)", async () => {
				// Scenario: Two condense operations occurred. User deletes a message that removes
				// the second condense_context but keeps the first. First summary should stay intact.
				const condenseId1 = "summary-first"
				const condenseId2 = "summary-second"

				getCurrentTaskMock.clineMessages = [
					{ ts: 100, say: "user", text: "First message" },
					{ ts: 200, say: "assistant", text: "Response 1" },
					// First condense_context created after first condense
					{
						ts: 800,
						say: "condense_context",
						contextCondense: { condenseId: condenseId1, summary: "First summary" },
					},
					{ ts: 900, say: "user", text: "After first condense" },
					{ ts: 1000, say: "assistant", text: "Response after 1st condense" },
					// Delete target - deleting this will remove the second condense_context below
					{ ts: 1100, say: "user", text: "Message to delete this and after" },
					// Second condense_context created after second condense (AFTER delete target)
					{
						ts: 1800,
						say: "condense_context",
						contextCondense: { condenseId: condenseId2, summary: "Second summary" },
					},
					{ ts: 1900, say: "user", text: "Post second condense" },
					{ ts: 2000, say: "assistant", text: "Final response" },
				]

				getCurrentTaskMock.apiConversationHistory = [
					{ ts: 100, role: "user", content: "First message" },
					// Messages from first condense (tagged with condenseId1)
					{ ts: 200, role: "assistant", content: "Response 1", condenseParent: condenseId1 },
					// First summary (also tagged with condenseId2 from second condense)
					{
						ts: 799,
						role: "assistant",
						content: "First summary",
						isSummary: true,
						condenseId: condenseId1,
						condenseParent: condenseId2,
					},
					{ ts: 900, role: "user", content: "After first condense", condenseParent: condenseId2 },
					{
						ts: 1000,
						role: "assistant",
						content: "Response after 1st condense",
						condenseParent: condenseId2,
					},
					{ ts: 1100, role: "user", content: "Message to delete this and after" },
					// Second summary (timestamp is BEFORE the messages it summarized for sort purposes)
					{
						ts: 1799,
						role: "assistant",
						content: "Second summary",
						isSummary: true,
						condenseId: condenseId2,
					},
					{ ts: 1900, role: "user", content: "Post second condense" },
					{ ts: 2000, role: "assistant", content: "Final response" },
				]

				// Delete at ts=1100 - this removes second condense_context (ts=1800) but keeps first (ts=800)
				await webviewMessageHandler(provider, {
					type: "deleteMessageConfirm",
					messageTs: 1100,
				})

				expect(getCurrentTaskMock.overwriteApiConversationHistory).toHaveBeenCalled()
				const result = getCurrentTaskMock.overwriteApiConversationHistory.mock.calls[0][0]

				// First summary should be PRESERVED (its condense_context is not being removed)
				const firstSummary = result.find((msg: any) => msg.condenseId === condenseId1)
				expect(firstSummary).toBeDefined()
				expect(firstSummary.content).toBe("First summary")
				expect(firstSummary.isSummary).toBe(true)

				// Second summary should be REMOVED (its condense_context is being removed)
				const secondSummary = result.find((msg: any) => msg.condenseId === condenseId2)
				expect(secondSummary).toBeUndefined()

				// Messages that were tagged with condenseId2 should have their tags cleared
				const afterFirstCondense = result.find((msg: any) => msg.content === "After first condense")
				expect(afterFirstCondense?.condenseParent).toBeUndefined() // Tag cleared

				// Messages tagged with condenseId1 should KEEP their tags
				const response1 = result.find((msg: any) => msg.content === "Response 1")
				expect(response1?.condenseParent).toBe(condenseId1) // Tag preserved
			})
		})
	})
})
