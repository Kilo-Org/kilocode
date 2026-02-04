import { NativeToolCallParser } from "../NativeToolCallParser"

describe("NativeToolCallParser", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	describe("parseToolCall", () => {
		describe("read_file tool", () => {
			it("should parse minimal single-file read_file args", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/core/task/Task.ts",
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					expect(result.nativeArgs).toBeDefined()
					const nativeArgs = result.nativeArgs as { path: string }
					expect(nativeArgs.path).toBe("src/core/task/Task.ts")
				}
			})

			it("should parse slice-mode params", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/core/task/Task.ts",
						mode: "slice",
						offset: 10,
						limit: 20,
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as {
						path: string
						mode?: string
						offset?: number
						limit?: number
					}
					expect(nativeArgs.path).toBe("src/core/task/Task.ts")
					expect(nativeArgs.mode).toBe("slice")
					expect(nativeArgs.offset).toBe(10)
					expect(nativeArgs.limit).toBe(20)
				}
			})

			it("should parse indentation-mode params", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/utils.ts",
						mode: "indentation",
						indentation: {
							anchor_line: 123,
							max_levels: 2,
							include_siblings: true,
							include_header: false,
						},
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as {
						path: string
						mode?: string
						indentation?: {
							anchor_line?: number
							max_levels?: number
							include_siblings?: boolean
							include_header?: boolean
						}
					}
					expect(nativeArgs.path).toBe("src/utils.ts")
					expect(nativeArgs.mode).toBe("indentation")
					expect(nativeArgs.indentation?.anchor_line).toBe(123)
					expect(nativeArgs.indentation?.include_siblings).toBe(true)
					expect(nativeArgs.indentation?.include_header).toBe(false)
				}
			})

			// Legacy format backward compatibility tests
			describe("legacy format backward compatibility", () => {
				it("should parse legacy files array format with single file", () => {
					const toolCall = {
						id: "toolu_legacy_1",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [{ path: "src/legacy/file.ts" }],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as { files: Array<{ path: string }>; _legacyFormat: true }
						expect(nativeArgs._legacyFormat).toBe(true)
						expect(nativeArgs.files).toHaveLength(1)
						expect(nativeArgs.files[0].path).toBe("src/legacy/file.ts")
					}
				})

				it("should parse legacy files array format with multiple files", () => {
					const toolCall = {
						id: "toolu_legacy_2",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [{ path: "src/file1.ts" }, { path: "src/file2.ts" }, { path: "src/file3.ts" }],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as { files: Array<{ path: string }>; _legacyFormat: true }
						expect(nativeArgs.files).toHaveLength(3)
						expect(nativeArgs.files[0].path).toBe("src/file1.ts")
						expect(nativeArgs.files[1].path).toBe("src/file2.ts")
						expect(nativeArgs.files[2].path).toBe("src/file3.ts")
					}
				})

				it("should parse legacy line_ranges as tuples", () => {
					const toolCall = {
						id: "toolu_legacy_3",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: [
										[1, 50],
										[100, 150],
									],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
							_legacyFormat: true
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 1, end: 50 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 100, end: 150 })
					}
				})

				it("should parse legacy line_ranges as objects", () => {
					const toolCall = {
						id: "toolu_legacy_4",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: [
										{ start: 10, end: 20 },
										{ start: 30, end: 40 },
									],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 10, end: 20 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 30, end: 40 })
					}
				})

				it("should parse legacy line_ranges as strings", () => {
					const toolCall = {
						id: "toolu_legacy_5",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: ["1-50", "100-150"],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 1, end: 50 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 100, end: 150 })
					}
				})

				it("should parse double-stringified files array (model quirk)", () => {
					// This tests the real-world case where some models double-stringify the files array
					// e.g., { files: "[{\"path\": \"...\"}]" } instead of { files: [{path: "..."}] }
					const toolCall = {
						id: "toolu_double_stringify",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: JSON.stringify([
								{ path: "src/services/browser/browserDiscovery.ts" },
								{ path: "src/services/mcp/McpServerManager.ts" },
							]),
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string }>
							_legacyFormat: true
						}
						expect(nativeArgs._legacyFormat).toBe(true)
						expect(nativeArgs.files).toHaveLength(2)
						expect(nativeArgs.files[0].path).toBe("src/services/browser/browserDiscovery.ts")
						expect(nativeArgs.files[1].path).toBe("src/services/mcp/McpServerManager.ts")
					}
				})

				it("should NOT set usedLegacyFormat for new format", () => {
					const toolCall = {
						id: "toolu_new",
						name: "read_file" as const,
						arguments: JSON.stringify({
							path: "src/new/format.ts",
							mode: "slice",
							offset: 1,
							limit: 100,
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBeUndefined()
					}
				})
			})
		})
	})

	describe("processStreamingChunk", () => {
		describe("read_file tool", () => {
			it("should emit a partial ToolUse with nativeArgs.path during streaming", () => {
				const id = "toolu_streaming_123"
				NativeToolCallParser.startStreamingToolCall(id, "read_file")

				// Simulate streaming chunks
				const fullArgs = JSON.stringify({ path: "src/test.ts" })

				// Process the complete args as a single chunk for simplicity
				const result = NativeToolCallParser.processStreamingChunk(id, fullArgs)

				expect(result).not.toBeNull()
				expect(result?.nativeArgs).toBeDefined()
				const nativeArgs = result?.nativeArgs as { path: string }
				expect(nativeArgs.path).toBe("src/test.ts")
			})
		})
	})

	describe("finalizeStreamingToolCall", () => {
		describe("read_file tool", () => {
			it("should parse read_file args on finalize", () => {
				const id = "toolu_finalize_123"
				NativeToolCallParser.startStreamingToolCall(id, "read_file")

				// Add the complete arguments
				NativeToolCallParser.processStreamingChunk(
					id,
					JSON.stringify({
						path: "finalized.ts",
						mode: "slice",
						offset: 1,
						limit: 10,
					}),
				)

				const result = NativeToolCallParser.finalizeStreamingToolCall(id)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as { path: string; offset?: number; limit?: number }
					expect(nativeArgs.path).toBe("finalized.ts")
					expect(nativeArgs.offset).toBe(1)
					expect(nativeArgs.limit).toBe(10)
				}
			})
		})
	})
})
