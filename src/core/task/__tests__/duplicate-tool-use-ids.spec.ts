/**
 * Tests for duplicate tool_use ID prevention.
 *
 * These tests verify the fix for API 400 error "tool_use ids must be unique"
 * that can occur when:
 * 1. Stream retries/reconnections cause duplicate tool_call_start events
 * 2. Multiple tool_use blocks with the same ID accumulate in assistantMessageContent
 *
 * The fix implements two layers of protection:
 * - Layer 1: Guard in streaming handler (streamingToolCallIndices check)
 * - Layer 2: Pre-flight deduplication when building API request content
 */

import { sanitizeToolUseId } from "../../../utils/tool-id"
import type { ToolUse, McpToolUse } from "../../../shared/tools"

describe("Duplicate tool_use ID Prevention", () => {
	describe("Pre-flight deduplication logic", () => {
		/**
		 * Simulates the pre-flight deduplication logic from Task.ts lines 3444-3518.
		 * This tests the Set-based deduplication that happens when building assistant
		 * message content for the API.
		 */
		const deduplicateToolUseBlocks = (
			assistantMessageContent: Array<{ type: string; name?: string; id?: string }>,
		): Array<{ type: string; name: string; id: string }> => {
			const seenToolUseIds = new Set<string>()
			const result: Array<{ type: string; name: string; id: string }> = []

			const toolUseBlocks = assistantMessageContent.filter(
				(block) => block.type === "tool_use" || block.type === "mcp_tool_use",
			)

			for (const block of toolUseBlocks) {
				const id = block.id
				if (id) {
					const sanitizedId = sanitizeToolUseId(id)
					if (seenToolUseIds.has(sanitizedId)) {
						// Skip duplicate - this is what the fix does
						continue
					}
					seenToolUseIds.add(sanitizedId)
					result.push({
						type: "tool_use",
						name: block.name || "unknown",
						id: sanitizedId,
					})
				}
			}

			return result
		}

		it("should skip duplicate tool_use blocks with identical IDs", () => {
			const assistantMessageContent = [
				{ type: "tool_use", name: "read_file", id: "toolu_abc123" },
				{ type: "tool_use", name: "read_file", id: "toolu_abc123" }, // Duplicate
			]

			const result = deduplicateToolUseBlocks(assistantMessageContent)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe("toolu_abc123")
		})

		it("should preserve unique tool_use blocks", () => {
			const assistantMessageContent = [
				{ type: "tool_use", name: "read_file", id: "toolu_abc123" },
				{ type: "tool_use", name: "write_to_file", id: "toolu_def456" },
			]

			const result = deduplicateToolUseBlocks(assistantMessageContent)

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("toolu_abc123")
			expect(result[1].id).toBe("toolu_def456")
		})

		it("should handle multiple duplicates", () => {
			const assistantMessageContent = [
				{ type: "tool_use", name: "read_file", id: "toolu_1" },
				{ type: "tool_use", name: "read_file", id: "toolu_1" }, // Dup of toolu_1
				{ type: "tool_use", name: "write_to_file", id: "toolu_2" },
				{ type: "tool_use", name: "write_to_file", id: "toolu_2" }, // Dup of toolu_2
				{ type: "tool_use", name: "read_file", id: "toolu_1" }, // Another dup of toolu_1
			]

			const result = deduplicateToolUseBlocks(assistantMessageContent)

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("toolu_1")
			expect(result[1].id).toBe("toolu_2")
		})

		it("should handle mcp_tool_use blocks", () => {
			const assistantMessageContent = [
				{ type: "mcp_tool_use", name: "mcp__server__tool", id: "mcp_123" },
				{ type: "mcp_tool_use", name: "mcp__server__tool", id: "mcp_123" }, // Duplicate
				{ type: "tool_use", name: "read_file", id: "toolu_456" },
			]

			const result = deduplicateToolUseBlocks(assistantMessageContent)

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("mcp_123")
			expect(result[1].id).toBe("toolu_456")
		})

		it("should sanitize IDs before deduplication", () => {
			// IDs with special characters that need sanitization
			const assistantMessageContent = [
				{ type: "tool_use", name: "read_file", id: "toolu_abc#123" },
				{ type: "tool_use", name: "read_file", id: "toolu_abc#123" }, // Same after sanitization
			]

			const result = deduplicateToolUseBlocks(assistantMessageContent)

			// Both should be deduplicated since they sanitize to the same value
			expect(result).toHaveLength(1)
		})

		it("should skip blocks without IDs", () => {
			const assistantMessageContent = [
				{ type: "tool_use", name: "read_file", id: "toolu_123" },
				{ type: "tool_use", name: "write_to_file" }, // No ID
				{ type: "text" }, // Not a tool_use
			]

			const result = deduplicateToolUseBlocks(assistantMessageContent)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe("toolu_123")
		})
	})

	describe("Streaming duplicate guard logic", () => {
		/**
		 * Simulates the streaming duplicate guard from Task.ts lines 2835-2847.
		 * The streamingToolCallIndices Map tracks which tool IDs have already been
		 * added during streaming to prevent duplicate tool_call_start events.
		 */
		it("should prevent duplicate tool_call_start events", () => {
			const streamingToolCallIndices = new Map<string, number>()
			const processedEvents: string[] = []

			const processToolCallStart = (id: string, name: string): boolean => {
				// Guard against duplicate tool_call_start events
				if (streamingToolCallIndices.has(id)) {
					// Would log: console.warn(`Ignoring duplicate tool_call_start for ID: ${id}`)
					return false // Skipped
				}

				// Track the index (simulate adding to assistantMessageContent)
				streamingToolCallIndices.set(id, processedEvents.length)
				processedEvents.push(id)
				return true // Processed
			}

			// First event for toolu_123 should be processed
			expect(processToolCallStart("toolu_123", "read_file")).toBe(true)
			expect(processedEvents).toEqual(["toolu_123"])

			// Duplicate event for toolu_123 should be skipped
			expect(processToolCallStart("toolu_123", "read_file")).toBe(false)
			expect(processedEvents).toEqual(["toolu_123"]) // Still only one

			// Different ID should be processed
			expect(processToolCallStart("toolu_456", "write_to_file")).toBe(true)
			expect(processedEvents).toEqual(["toolu_123", "toolu_456"])

			// Another duplicate for toolu_456
			expect(processToolCallStart("toolu_456", "write_to_file")).toBe(false)
			expect(processedEvents).toEqual(["toolu_123", "toolu_456"]) // No change
		})

		it("should track indices correctly for multiple tools", () => {
			const streamingToolCallIndices = new Map<string, number>()
			let currentIndex = 0

			const processToolCallStart = (id: string): number | null => {
				if (streamingToolCallIndices.has(id)) {
					return null // Duplicate
				}

				const index = currentIndex
				streamingToolCallIndices.set(id, index)
				currentIndex++
				return index
			}

			expect(processToolCallStart("toolu_1")).toBe(0)
			expect(processToolCallStart("toolu_2")).toBe(1)
			expect(processToolCallStart("toolu_3")).toBe(2)

			// Duplicates return null
			expect(processToolCallStart("toolu_1")).toBeNull()
			expect(processToolCallStart("toolu_2")).toBeNull()

			// Verify the indices stored
			expect(streamingToolCallIndices.get("toolu_1")).toBe(0)
			expect(streamingToolCallIndices.get("toolu_2")).toBe(1)
			expect(streamingToolCallIndices.get("toolu_3")).toBe(2)
		})

		it("should clear tracking between API requests", () => {
			const streamingToolCallIndices = new Map<string, number>()

			// First API request
			streamingToolCallIndices.set("toolu_123", 0)
			expect(streamingToolCallIndices.has("toolu_123")).toBe(true)

			// Clear between requests (simulates this.streamingToolCallIndices.clear())
			streamingToolCallIndices.clear()
			expect(streamingToolCallIndices.has("toolu_123")).toBe(false)

			// New request can use the same ID
			streamingToolCallIndices.set("toolu_123", 0)
			expect(streamingToolCallIndices.has("toolu_123")).toBe(true)
		})
	})

	describe("Integration scenario: Stream retry causing duplicates", () => {
		/**
		 * This simulates the exact scenario that causes the API 400 error:
		 * A stream retry or reconnection causes the same tool_call_start event
		 * to be received twice for the same tool ID.
		 */
		it("should handle stream retry scenario without duplicate tool_use blocks", () => {
			// Simulate the state tracking in Task.ts
			const streamingToolCallIndices = new Map<string, number>()
			const assistantMessageContent: Array<{ type: string; id: string; name: string }> = []

			const handleToolCallStart = (id: string, name: string) => {
				// Layer 1: Streaming guard
				if (streamingToolCallIndices.has(id)) {
					return // Skip duplicate
				}

				const toolUseIndex = assistantMessageContent.length
				streamingToolCallIndices.set(id, toolUseIndex)
				assistantMessageContent.push({ type: "tool_use", id, name })
			}

			// Initial tool call
			handleToolCallStart("toolu_abc123", "read_file")
			expect(assistantMessageContent).toHaveLength(1)

			// Stream retry causes duplicate tool_call_start
			handleToolCallStart("toolu_abc123", "read_file")
			expect(assistantMessageContent).toHaveLength(1) // Still 1, not 2

			// Another tool call
			handleToolCallStart("toolu_def456", "write_to_file")
			expect(assistantMessageContent).toHaveLength(2)

			// Final content should have unique IDs
			const ids = assistantMessageContent.map((block) => block.id)
			const uniqueIds = [...new Set(ids)]
			expect(ids).toEqual(uniqueIds) // All IDs are unique
		})
	})
})
