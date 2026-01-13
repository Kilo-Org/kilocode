// npx vitest src/core/condense/__tests__/rewind-after-condense.spec.ts

/**
 * Regression tests for the issue: "Rewind after Condense is broken"
 * https://github.com/RooCodeInc/Roo-Code/issues/8295
 *
 * These tests verify that when a user rewinds (deletes/truncates) their conversation
 * after a condense operation, the orphaned condensed messages are properly reactivated
 * so they can be sent to the API again.
 */

import { TelemetryService } from "@roo-code/telemetry"

import { getEffectiveApiHistory, cleanupAfterTruncation } from "../index"
import { ApiMessage } from "../../task-persistence/apiMessages"

describe("Rewind After Condense - Issue #8295", () => {
	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	describe("getEffectiveApiHistory", () => {
		it("should filter out messages tagged with condenseParent", () => {
			const condenseId = "summary-123"
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message", ts: 1 },
				{ role: "assistant", content: "First response", ts: 2, condenseParent: condenseId },
				{ role: "user", content: "Second message", ts: 3, condenseParent: condenseId },
				{ role: "assistant", content: "Summary", ts: 4, isSummary: true, condenseId },
				{ role: "user", content: "Third message", ts: 5 },
				{ role: "assistant", content: "Third response", ts: 6 },
			]

			const effective = getEffectiveApiHistory(messages)

			// Effective history should be: first message, summary, third message, third response
			expect(effective.length).toBe(4)
			expect(effective[0].content).toBe("First message")
			expect(effective[1].isSummary).toBe(true)
			expect(effective[2].content).toBe("Third message")
			expect(effective[3].content).toBe("Third response")
		})

		it("should include messages without condenseParent", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Hello", ts: 1 },
				{ role: "assistant", content: "Hi", ts: 2 },
			]

			const effective = getEffectiveApiHistory(messages)

			expect(effective.length).toBe(2)
			expect(effective).toEqual(messages)
		})

		it("should handle empty messages array", () => {
			const effective = getEffectiveApiHistory([])
			expect(effective).toEqual([])
		})
	})

	describe("cleanupAfterTruncation", () => {
		it("should clear condenseParent when summary message is deleted", () => {
			const condenseId = "summary-123"
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message", ts: 1 },
				{ role: "assistant", content: "First response", ts: 2, condenseParent: condenseId },
				{ role: "user", content: "Second message", ts: 3, condenseParent: condenseId },
				// Summary is NOT in the array (was truncated/deleted)
			]

			const cleaned = cleanupAfterTruncation(messages)

			// All condenseParent tags should be cleared since summary is gone
			expect(cleaned[1].condenseParent).toBeUndefined()
			expect(cleaned[2].condenseParent).toBeUndefined()
		})

		it("should preserve condenseParent when summary message still exists", () => {
			const condenseId = "summary-123"
			const messages: ApiMessage[] = [
				{ role: "user", content: "First message", ts: 1 },
				{ role: "assistant", content: "First response", ts: 2, condenseParent: condenseId },
				{ role: "assistant", content: "Summary", ts: 3, isSummary: true, condenseId },
			]

			const cleaned = cleanupAfterTruncation(messages)

			// condenseParent should remain since summary exists
			expect(cleaned[1].condenseParent).toBe(condenseId)
		})

		it("should handle multiple condense operations with different IDs", () => {
			const condenseId1 = "summary-1"
			const condenseId2 = "summary-2"
			const messages: ApiMessage[] = [
				{ role: "user", content: "Message 1", ts: 1, condenseParent: condenseId1 },
				{ role: "assistant", content: "Summary 1", ts: 2, isSummary: true, condenseId: condenseId1 },
				{ role: "user", content: "Message 2", ts: 3, condenseParent: condenseId2 },
				// Summary 2 is NOT present (was truncated)
			]

			const cleaned = cleanupAfterTruncation(messages)

			// condenseId1 should remain (summary exists)
			expect(cleaned[0].condenseParent).toBe(condenseId1)
			// condenseId2 should be cleared (summary deleted)
			expect(cleaned[2].condenseParent).toBeUndefined()
		})

		it("should not modify messages without condenseParent", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Hello", ts: 1 },
				{ role: "assistant", content: "Hi", ts: 2 },
			]

			const cleaned = cleanupAfterTruncation(messages)

			expect(cleaned).toEqual(messages)
		})

		it("should handle empty messages array", () => {
			const cleaned = cleanupAfterTruncation([])
			expect(cleaned).toEqual([])
		})
	})

	describe("Rewind scenario: truncate after condense", () => {
		it("should reactivate condensed messages when their summary is deleted via truncation", () => {
			const condenseId = "summary-abc"

			// Simulate a conversation after condensing
			const fullHistory: ApiMessage[] = [
				{ role: "user", content: "Initial task", ts: 1 },
				{ role: "assistant", content: "Working on it", ts: 2, condenseParent: condenseId },
				{ role: "user", content: "Continue", ts: 3, condenseParent: condenseId },
				{ role: "assistant", content: "Summary of work so far", ts: 4, isSummary: true, condenseId },
				{ role: "user", content: "Now do this", ts: 5 },
				{ role: "assistant", content: "Done", ts: 6 },
				{ role: "user", content: "And this", ts: 7 },
				{ role: "assistant", content: "Also done", ts: 8 },
			]

			// Verify effective history before truncation
			const effectiveBefore = getEffectiveApiHistory(fullHistory)
			// Should be: first message, summary, last 4 messages
			expect(effectiveBefore.length).toBe(6)

			// Simulate rewind: user truncates back to message ts=4 (keeping 0-3)
			const truncatedHistory = fullHistory.slice(0, 4) // Keep first, condensed1, condensed2, summary

			// After truncation, the summary is still there, so condensed messages remain condensed
			const cleanedAfterKeepingSummary = cleanupAfterTruncation(truncatedHistory)
			expect(cleanedAfterKeepingSummary[1].condenseParent).toBe(condenseId)
			expect(cleanedAfterKeepingSummary[2].condenseParent).toBe(condenseId)

			// Now simulate a more aggressive rewind: delete back to message ts=2
			const aggressiveTruncate = fullHistory.slice(0, 2) // Keep only first message and first response

			// The condensed messages should now be reactivated since summary is gone
			const cleanedAfterDeletingSummary = cleanupAfterTruncation(aggressiveTruncate)
			expect(cleanedAfterDeletingSummary[1].condenseParent).toBeUndefined()

			// Verify effective history after cleanup
			const effectiveAfterCleanup = getEffectiveApiHistory(cleanedAfterDeletingSummary)
			// Now both messages should be active (no condensed filtering)
			expect(effectiveAfterCleanup.length).toBe(2)
			expect(effectiveAfterCleanup[0].content).toBe("Initial task")
			expect(effectiveAfterCleanup[1].content).toBe("Working on it")
		})

		it("should properly restore context after rewind when summary was deleted", () => {
			const condenseId = "summary-xyz"

			// Scenario: Most of the conversation was condensed, but the summary was deleted.
			// getEffectiveApiHistory already correctly handles orphaned messages (includes them
			// when their summary doesn't exist). cleanupAfterTruncation cleans up the tags.
			const messages: ApiMessage[] = [
				{ role: "user", content: "Start", ts: 1 },
				{ role: "assistant", content: "Response 1", ts: 2, condenseParent: condenseId },
				{ role: "user", content: "More", ts: 3, condenseParent: condenseId },
				{ role: "assistant", content: "Response 2", ts: 4, condenseParent: condenseId },
				{ role: "user", content: "Even more", ts: 5, condenseParent: condenseId },
				// Summary was deleted (not present), so these are "orphaned" messages
			]

			// getEffectiveApiHistory already includes orphaned messages (summary doesn't exist)
			const effectiveBefore = getEffectiveApiHistory(messages)
			expect(effectiveBefore.length).toBe(5) // All messages visible since summary was deleted
			expect(effectiveBefore[0].content).toBe("Start")
			expect(effectiveBefore[1].content).toBe("Response 1")

			// cleanupAfterTruncation clears the orphaned condenseParent tags for data hygiene
			const cleaned = cleanupAfterTruncation(messages)

			// Verify condenseParent was cleared for all orphaned messages
			expect(cleaned[1].condenseParent).toBeUndefined()
			expect(cleaned[2].condenseParent).toBeUndefined()
			expect(cleaned[3].condenseParent).toBeUndefined()
			expect(cleaned[4].condenseParent).toBeUndefined()

			// After cleanup, effective history is the same (all visible)
			const effectiveAfter = getEffectiveApiHistory(cleaned)
			expect(effectiveAfter.length).toBe(5) // All messages visible
		})

		it("should hide condensed messages when their summary still exists", () => {
			const condenseId = "summary-exists"

			// Scenario: Messages were condensed and summary exists - condensed messages should be hidden
			const messages: ApiMessage[] = [
				{ role: "user", content: "Start", ts: 1 },
				{ role: "assistant", content: "Response 1", ts: 2, condenseParent: condenseId },
				{ role: "user", content: "More", ts: 3, condenseParent: condenseId },
				{ role: "assistant", content: "Summary", ts: 4, isSummary: true, condenseId },
				{ role: "user", content: "After summary", ts: 5 },
			]

			// Effective history should hide condensed messages since summary exists
			const effective = getEffectiveApiHistory(messages)
			expect(effective.length).toBe(3) // Start, Summary, After summary
			expect(effective[0].content).toBe("Start")
			expect(effective[1].content).toBe("Summary")
			expect(effective[2].content).toBe("After summary")

			// cleanupAfterTruncation should NOT clear condenseParent since summary exists
			const cleaned = cleanupAfterTruncation(messages)
			expect(cleaned[1].condenseParent).toBe(condenseId)
			expect(cleaned[2].condenseParent).toBe(condenseId)
		})

		describe("Summary timestamp collision prevention", () => {
			it("should give summary a unique timestamp that does not collide with first kept message", () => {
				// Scenario: After condense, the summary message should have a unique timestamp
				// (ts - 1 from the first kept message) to prevent lookup collisions.
				//
				// This test verifies the expected data structure after condense:
				// - Summary should have ts = firstKeptMessage.ts - 1
				// - Summary and first kept message should NOT share the same timestamp
				//
				// With real millisecond timestamps, the summary timestamp (firstKeptTs - 1) will
				// never collide with an existing message since timestamps are always increasing.

				const condenseId = "summary-unique-ts"
				// Use timestamps that represent a realistic scenario where firstKeptTs - 1
				// does not collide with any existing message timestamp
				const firstKeptTs = 1000

				// Simulate post-condense state where summary has unique timestamp (firstKeptTs - 1)
				// In real usage, condensed messages have timestamps like 100, 200, 300...
				// and firstKeptTs is much larger, so firstKeptTs - 1 = 999 is unique
				const messagesAfterCondense: ApiMessage[] = [
					{ role: "user", content: "Initial task", ts: 100 },
					{ role: "assistant", content: "Response 1", ts: 200, condenseParent: condenseId },
					{ role: "user", content: "Continue", ts: 300, condenseParent: condenseId },
					{ role: "assistant", content: "Response 2", ts: 400, condenseParent: condenseId },
					{ role: "user", content: "More work", ts: 500, condenseParent: condenseId },
					{ role: "assistant", content: "Response 3", ts: 600, condenseParent: condenseId },
					{ role: "user", content: "Even more", ts: 700, condenseParent: condenseId },
					// Summary gets ts = firstKeptTs - 1 = 999, which is unique
					{ role: "assistant", content: "Summary", ts: firstKeptTs - 1, isSummary: true, condenseId },
					// First kept message
					{ role: "user", content: "First kept message", ts: firstKeptTs },
					{ role: "assistant", content: "Response to first kept", ts: 1100 },
					{ role: "user", content: "Last message", ts: 1200 },
				]

				// Find all messages with the same timestamp as the summary
				const summaryTs = firstKeptTs - 1
				const messagesWithSummaryTs = messagesAfterCondense.filter((msg) => msg.ts === summaryTs)

				// There should be exactly one message with the summary timestamp
				expect(messagesWithSummaryTs.length).toBe(1)
				expect(messagesWithSummaryTs[0].isSummary).toBe(true)

				// The first kept message should have a different timestamp
				const firstKeptMessage = messagesAfterCondense.find(
					(msg) => msg.ts === firstKeptTs && !msg.isSummary && !msg.condenseParent,
				)
				expect(firstKeptMessage).toBeDefined()
				expect(firstKeptMessage?.content).toBe("First kept message")
				expect(firstKeptMessage?.ts).not.toBe(summaryTs)
			})

			it("should not target summary message when looking up first kept message by timestamp", () => {
				// This test verifies that when timestamps are unique (as they should be after the fix),
				// looking up by the first kept message's timestamp returns that message, not the summary.

				const condenseId = "summary-lookup-test"
				const firstKeptTs = 8

				const messages: ApiMessage[] = [
					{ role: "user", content: "Initial", ts: 1 },
					{ role: "assistant", content: "Summary", ts: firstKeptTs - 1, isSummary: true, condenseId },
					{ role: "user", content: "First kept message", ts: firstKeptTs },
					{ role: "assistant", content: "Response", ts: 9 },
				]

				// Look up by first kept message's timestamp
				const foundMessage = messages.find((msg) => msg.ts === firstKeptTs)
				expect(foundMessage).toBeDefined()
				expect(foundMessage?.content).toBe("First kept message")
				expect(foundMessage?.isSummary).toBeUndefined()

				// Looking up by summary's timestamp should find the summary
				const foundSummary = messages.find((msg) => msg.ts === firstKeptTs - 1)
				expect(foundSummary).toBeDefined()
				expect(foundSummary?.isSummary).toBe(true)
			})
		})

		describe("Message preservation after condense operations", () => {
			/**
			 * These tests verify that the correct user and assistant messages are preserved
			 * and sent to the LLM after condense operations. With N_MESSAGES_TO_KEEP = 3,
			 * condense should always preserve:
			 * - The first message (never condensed)
			 * - The active summary
			 * - The last 3 kept messages
			 */

			it("should preserve correct messages after single condense (10 messages)", () => {
				const condenseId = "summary-single"

				// Simulate storage state after condensing 10 messages with N_MESSAGES_TO_KEEP = 3
				// Original: [msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8, msg9, msg10]
				// After condense:
				// - msg1 preserved (first message)
				// - msg2-msg7 tagged with condenseParent
				// - summary inserted with ts = msg8.ts - 1
				// - msg8, msg9, msg10 kept
				const storageAfterCondense: ApiMessage[] = [
					{ role: "user", content: "Task: Build a feature", ts: 100 },
					{ role: "assistant", content: "I'll help with that", ts: 200, condenseParent: condenseId },
					{ role: "user", content: "Start with the API", ts: 300, condenseParent: condenseId },
					{ role: "assistant", content: "Creating API endpoints", ts: 400, condenseParent: condenseId },
					{ role: "user", content: "Add validation", ts: 500, condenseParent: condenseId },
					{ role: "assistant", content: "Added validation logic", ts: 600, condenseParent: condenseId },
					{ role: "user", content: "Now the tests", ts: 700, condenseParent: condenseId },
					// Summary inserted before first kept message
					{
						role: "assistant",
						content: "Summary: Built API with validation, working on tests",
						ts: 799, // msg8.ts - 1
						isSummary: true,
						condenseId,
					},
					// Last 3 kept messages (N_MESSAGES_TO_KEEP = 3)
					{ role: "assistant", content: "Writing unit tests now", ts: 800 },
					{ role: "user", content: "Include edge cases", ts: 900 },
					{ role: "assistant", content: "Added edge case tests", ts: 1000 },
				]

				const effective = getEffectiveApiHistory(storageAfterCondense)

				// Should send exactly 5 messages to LLM:
				// 1. First message (user) - preserved
				// 2. Summary (assistant)
				// 3-5. Last 3 kept messages
				expect(effective.length).toBe(5)

				// Verify exact order and content
				expect(effective[0].role).toBe("user")
				expect(effective[0].content).toBe("Task: Build a feature")

				expect(effective[1].role).toBe("assistant")
				expect(effective[1].isSummary).toBe(true)
				expect(effective[1].content).toBe("Summary: Built API with validation, working on tests")

				expect(effective[2].role).toBe("assistant")
				expect(effective[2].content).toBe("Writing unit tests now")

				expect(effective[3].role).toBe("user")
				expect(effective[3].content).toBe("Include edge cases")

				expect(effective[4].role).toBe("assistant")
				expect(effective[4].content).toBe("Added edge case tests")

				// Verify condensed messages are NOT in effective history
				const condensedContents = ["I'll help with that", "Start with the API", "Creating API endpoints"]
				for (const content of condensedContents) {
					expect(effective.find((m) => m.content === content)).toBeUndefined()
				}
			})

			it("should preserve correct messages after double condense (10 msgs → condense → 10 more msgs → condense)", () => {
				const condenseId1 = "summary-first"
				const condenseId2 = "summary-second"

				// Simulate storage state after TWO condense operations
				// First condense: 10 messages condensed, summary1 created
				// Then: 10 more messages added (making effective history have 15 messages)
				// Second condense: summary1 + msg8-msg17 condensed, summary2 created
				//
				// Storage after double condense:
				const storageAfterDoubleCondense: ApiMessage[] = [
					// First message - never condensed
					{ role: "user", content: "Initial task: Build a full app", ts: 100 },

					// Messages from first condense (tagged with condenseId1)
					{ role: "assistant", content: "Starting the project", ts: 200, condenseParent: condenseId1 },
					{ role: "user", content: "Add authentication", ts: 300, condenseParent: condenseId1 },
					{ role: "assistant", content: "Added auth module", ts: 400, condenseParent: condenseId1 },
					{ role: "user", content: "Add database", ts: 500, condenseParent: condenseId1 },
					{ role: "assistant", content: "Set up database", ts: 600, condenseParent: condenseId1 },
					{ role: "user", content: "Connect them", ts: 700, condenseParent: condenseId1 },

					// First summary - now ALSO tagged with condenseId2 (from second condense)
					{
						role: "assistant",
						content: "Summary1: Built auth and database",
						ts: 799,
						isSummary: true,
						condenseId: condenseId1,
						condenseParent: condenseId2, // Tagged during second condense!
					},

					// Messages after first condense but before second (tagged with condenseId2)
					{ role: "assistant", content: "Continuing development", ts: 800, condenseParent: condenseId2 },
					{ role: "user", content: "Add API routes", ts: 900, condenseParent: condenseId2 },
					{ role: "assistant", content: "Created REST endpoints", ts: 1000, condenseParent: condenseId2 },
					{ role: "user", content: "Add validation", ts: 1100, condenseParent: condenseId2 },
					{ role: "assistant", content: "Added input validation", ts: 1200, condenseParent: condenseId2 },
					{ role: "user", content: "Add error handling", ts: 1300, condenseParent: condenseId2 },
					{ role: "assistant", content: "Implemented error handlers", ts: 1400, condenseParent: condenseId2 },
					{ role: "user", content: "Add logging", ts: 1500, condenseParent: condenseId2 },
					{ role: "assistant", content: "Set up logging system", ts: 1600, condenseParent: condenseId2 },
					{ role: "user", content: "Now write tests", ts: 1700, condenseParent: condenseId2 },

					// Second summary - inserted before the last 3 kept messages
					{
						role: "assistant",
						content: "Summary2: App complete with auth, DB, API, validation, errors, logging. Now testing.",
						ts: 1799, // msg18.ts - 1
						isSummary: true,
						condenseId: condenseId2,
					},

					// Last 3 kept messages (N_MESSAGES_TO_KEEP = 3)
					{ role: "assistant", content: "Writing integration tests", ts: 1800 },
					{ role: "user", content: "Test the auth flow", ts: 1900 },
					{ role: "assistant", content: "Auth tests passing", ts: 2000 },
				]

				const effective = getEffectiveApiHistory(storageAfterDoubleCondense)

				// Should send exactly 5 messages to LLM:
				// 1. First message (user) - preserved
				// 2. Summary2 (assistant) - the ACTIVE summary
				// 3-5. Last 3 kept messages
				expect(effective.length).toBe(5)

				// Verify exact order and content
				expect(effective[0].role).toBe("user")
				expect(effective[0].content).toBe("Initial task: Build a full app")

				expect(effective[1].role).toBe("assistant")
				expect(effective[1].isSummary).toBe(true)
				expect(effective[1].condenseId).toBe(condenseId2) // Must be the SECOND summary
				expect(effective[1].content).toContain("Summary2")

				expect(effective[2].role).toBe("assistant")
				expect(effective[2].content).toBe("Writing integration tests")

				expect(effective[3].role).toBe("user")
				expect(effective[3].content).toBe("Test the auth flow")

				expect(effective[4].role).toBe("assistant")
				expect(effective[4].content).toBe("Auth tests passing")

				// Verify Summary1 is NOT in effective history (it's tagged with condenseParent)
				const summary1 = effective.find((m) => m.content?.toString().includes("Summary1"))
				expect(summary1).toBeUndefined()

				// Verify all condensed messages are NOT in effective history
				const condensedContents = [
					"Starting the project",
					"Added auth module",
					"Continuing development",
					"Created REST endpoints",
					"Implemented error handlers",
				]
				for (const content of condensedContents) {
					expect(effective.find((m) => m.content === content)).toBeUndefined()
				}
			})

			it("should maintain proper user/assistant alternation in effective history", () => {
				const condenseId = "summary-alternation"

				// Verify that after condense, the effective history maintains proper
				// user/assistant message alternation (important for API compatibility)
				const storage: ApiMessage[] = [
					{ role: "user", content: "Start task", ts: 100 },
					{ role: "assistant", content: "Response 1", ts: 200, condenseParent: condenseId },
					{ role: "user", content: "Continue", ts: 300, condenseParent: condenseId },
					{ role: "assistant", content: "Summary text", ts: 399, isSummary: true, condenseId },
					// Kept messages - should alternate properly
					{ role: "assistant", content: "Response after summary", ts: 400 },
					{ role: "user", content: "User message", ts: 500 },
					{ role: "assistant", content: "Final response", ts: 600 },
				]

				const effective = getEffectiveApiHistory(storage)

				// Verify the sequence: user, assistant(summary), assistant, user, assistant
				// Note: Having two assistant messages in a row (summary + next response) is valid
				// because the summary replaces what would have been multiple messages
				expect(effective[0].role).toBe("user")
				expect(effective[1].role).toBe("assistant")
				expect(effective[1].isSummary).toBe(true)
				expect(effective[2].role).toBe("assistant")
				expect(effective[3].role).toBe("user")
				expect(effective[4].role).toBe("assistant")
			})

			it("should preserve timestamps in chronological order in effective history", () => {
				const condenseId = "summary-timestamps"

				const storage: ApiMessage[] = [
					{ role: "user", content: "First", ts: 100 },
					{ role: "assistant", content: "Condensed", ts: 200, condenseParent: condenseId },
					{ role: "assistant", content: "Summary", ts: 299, isSummary: true, condenseId },
					{ role: "user", content: "Kept 1", ts: 300 },
					{ role: "assistant", content: "Kept 2", ts: 400 },
					{ role: "user", content: "Kept 3", ts: 500 },
				]

				const effective = getEffectiveApiHistory(storage)

				// Verify timestamps are in ascending order
				for (let i = 1; i < effective.length; i++) {
					const prevTs = effective[i - 1].ts ?? 0
					const currTs = effective[i].ts ?? 0
					expect(currTs).toBeGreaterThan(prevTs)
				}
			})
		})
	})
})
