import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"
import type { ChildProcess } from "child_process"
import { fetchAvailableModels, parseModelsOutput, type ModelsApiResponse } from "../CliModelsFetcher"

// Mock child_process
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

import { spawn } from "child_process"

const mockSpawn = vi.mocked(spawn)

function createMockProcess(): ChildProcess & { stdout: EventEmitter; stderr: EventEmitter } {
	const proc = new EventEmitter() as ChildProcess & { stdout: EventEmitter; stderr: EventEmitter }
	proc.stdout = new EventEmitter() as unknown as ChildProcess["stdout"] & EventEmitter
	proc.stderr = new EventEmitter() as unknown as ChildProcess["stderr"] & EventEmitter
	proc.kill = vi.fn()
	return proc
}

describe("CliModelsFetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("parseModelsOutput", () => {
		it("parses valid JSON output", () => {
			const validOutput = JSON.stringify({
				provider: "kilocode",
				currentModel: "claude-sonnet-4",
				models: [
					{
						id: "claude-sonnet-4",
						displayName: "Claude Sonnet 4",
						contextWindow: 200000,
						supportsImages: true,
						inputPrice: 3,
						outputPrice: 15,
					},
					{
						id: "claude-opus-4",
						displayName: "Claude Opus 4",
						contextWindow: 200000,
						supportsImages: true,
						inputPrice: 15,
						outputPrice: 75,
					},
				],
			})

			const result = parseModelsOutput(validOutput)

			expect(result).not.toBeNull()
			expect(result!.provider).toBe("kilocode")
			expect(result!.currentModel).toBe("claude-sonnet-4")
			expect(result!.models).toHaveLength(2)
			expect(result!.models[0].id).toBe("claude-sonnet-4")
		})

		it("returns null for invalid JSON", () => {
			const result = parseModelsOutput("not valid json {")

			expect(result).toBeNull()
		})

		it("returns null for JSON missing required fields", () => {
			const incompleteOutput = JSON.stringify({
				provider: "kilocode",
				// Missing currentModel and models
			})

			const result = parseModelsOutput(incompleteOutput)

			expect(result).toBeNull()
		})

		it("returns null for empty string", () => {
			const result = parseModelsOutput("")

			expect(result).toBeNull()
		})

		it("handles models with minimal fields", () => {
			const minimalOutput = JSON.stringify({
				provider: "anthropic",
				currentModel: "claude-3-5-sonnet",
				models: [
					{
						id: "claude-3-5-sonnet",
						displayName: null,
						contextWindow: 200000,
					},
				],
			})

			const result = parseModelsOutput(minimalOutput)

			expect(result).not.toBeNull()
			expect(result!.models[0].displayName).toBeNull()
			expect(result!.models[0].supportsImages).toBeUndefined()
		})
	})

	describe("fetchAvailableModels", () => {
		it("spawns CLI with correct arguments", async () => {
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", vi.fn())

			// Simulate successful output
			const validResponse: ModelsApiResponse = {
				provider: "kilocode",
				currentModel: "claude-sonnet-4",
				models: [{ id: "claude-sonnet-4", displayName: "Claude Sonnet 4", contextWindow: 200000 }],
			}
			mockProc.stdout.emit("data", JSON.stringify(validResponse))
			mockProc.emit("close", 0)

			await fetchPromise

			expect(mockSpawn).toHaveBeenCalledWith("/path/to/kilocode", ["models", "--json"], expect.any(Object))
		})

		it("returns parsed response on success", async () => {
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", vi.fn())

			const validResponse: ModelsApiResponse = {
				provider: "kilocode",
				currentModel: "claude-sonnet-4",
				models: [
					{ id: "claude-sonnet-4", displayName: "Claude Sonnet 4", contextWindow: 200000 },
					{ id: "claude-opus-4", displayName: "Claude Opus 4", contextWindow: 200000 },
				],
			}
			mockProc.stdout.emit("data", JSON.stringify(validResponse))
			mockProc.emit("close", 0)

			const result = await fetchPromise

			expect(result).not.toBeNull()
			expect(result!.provider).toBe("kilocode")
			expect(result!.models).toHaveLength(2)
		})

		it("returns null when CLI exits with non-zero code", async () => {
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)
			const log = vi.fn()

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", log)

			mockProc.stderr.emit("data", "Error: Provider not configured")
			mockProc.emit("close", 1)

			const result = await fetchPromise

			expect(result).toBeNull()
			expect(log).toHaveBeenCalledWith(expect.stringContaining("failed"))
		})

		it("returns null when stdout contains error JSON", async () => {
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", vi.fn())

			// CLI outputs error JSON
			mockProc.stdout.emit("data", JSON.stringify({ error: "Provider not found", code: "PROVIDER_NOT_FOUND" }))
			mockProc.emit("close", 1)

			const result = await fetchPromise

			expect(result).toBeNull()
		})

		it("returns null on timeout", async () => {
			vi.useFakeTimers()
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)
			const log = vi.fn()

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", log, 1000)

			// Advance past timeout
			vi.advanceTimersByTime(1500)

			const result = await fetchPromise

			expect(result).toBeNull()
			expect(mockProc.kill).toHaveBeenCalled()
			expect(log).toHaveBeenCalledWith(expect.stringContaining("timed out"))
		})

		it("handles spawn error gracefully", async () => {
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)
			const log = vi.fn()

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", log)

			mockProc.emit("error", new Error("spawn ENOENT"))

			const result = await fetchPromise

			expect(result).toBeNull()
			expect(log).toHaveBeenCalledWith(expect.stringContaining("spawn error"))
		})

		it("handles chunked stdout correctly", async () => {
			const mockProc = createMockProcess()
			mockSpawn.mockReturnValue(mockProc)

			const fetchPromise = fetchAvailableModels("/path/to/kilocode", vi.fn())

			// Simulate chunked output
			const validResponse: ModelsApiResponse = {
				provider: "kilocode",
				currentModel: "claude-sonnet-4",
				models: [{ id: "claude-sonnet-4", displayName: "Claude Sonnet 4", contextWindow: 200000 }],
			}
			const fullOutput = JSON.stringify(validResponse)
			// Split into chunks
			mockProc.stdout.emit("data", fullOutput.slice(0, 50))
			mockProc.stdout.emit("data", fullOutput.slice(50))
			mockProc.emit("close", 0)

			const result = await fetchPromise

			expect(result).not.toBeNull()
			expect(result!.provider).toBe("kilocode")
		})
	})
})
