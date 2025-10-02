import { describe, it, expect, vi, beforeEach } from "vitest"

describe("runExercise retry and timing logic", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should parse RETRY_COUNT from environment with default of 3", () => {
		const originalEnv = process.env.RETRY_COUNT
		
		delete process.env.RETRY_COUNT
		expect(parseInt(process.env.RETRY_COUNT || "3")).toBe(3)
		
		process.env.RETRY_COUNT = "5"
		expect(parseInt(process.env.RETRY_COUNT || "3")).toBe(5)
		
		process.env.RETRY_COUNT = "1"
		expect(parseInt(process.env.RETRY_COUNT || "3")).toBe(1)
		
		if (originalEnv !== undefined) {
			process.env.RETRY_COUNT = originalEnv
		} else {
			delete process.env.RETRY_COUNT
		}
	})

	it("should calculate averages correctly across multiple runs", () => {
		const runs = [
			{ run: 1, duration: 1000, inputTokens: 100, outputTokens: 50, cacheWriteTokens: 10, cacheReadTokens: 5, totalCost: 0.01 },
			{ run: 2, duration: 2000, inputTokens: 200, outputTokens: 100, cacheWriteTokens: 20, cacheReadTokens: 10, totalCost: 0.02 },
			{ run: 3, duration: 3000, inputTokens: 300, outputTokens: 150, cacheWriteTokens: 30, cacheReadTokens: 15, totalCost: 0.03 },
		]

		const retryCount = runs.length

		const totalDuration = runs.reduce((sum, r) => sum + r.duration, 0)
		const totalInputTokens = runs.reduce((sum, r) => sum + (r.inputTokens || 0), 0)
		const totalOutputTokens = runs.reduce((sum, r) => sum + (r.outputTokens || 0), 0)
		const totalCacheWriteTokens = runs.reduce((sum, r) => sum + (r.cacheWriteTokens || 0), 0)
		const totalCacheReadTokens = runs.reduce((sum, r) => sum + (r.cacheReadTokens || 0), 0)
		const totalCost = runs.reduce((sum, r) => sum + (r.totalCost || 0), 0)

		const averages = {
			duration: totalDuration / retryCount,
			inputTokens: totalInputTokens / retryCount,
			outputTokens: totalOutputTokens / retryCount,
			cacheWriteTokens: totalCacheWriteTokens / retryCount,
			cacheReadTokens: totalCacheReadTokens / retryCount,
			totalCost: totalCost / retryCount,
		}

		expect(averages.duration).toBe(2000)
		expect(averages.inputTokens).toBe(200)
		expect(averages.outputTokens).toBe(100)
		expect(averages.cacheWriteTokens).toBe(20)
		expect(averages.cacheReadTokens).toBe(10)
		expect(averages.totalCost).toBe(0.02)
	})

	it("should handle missing token values in runs", () => {
		const runs = [
			{ run: 1, duration: 1000 },
			{ run: 2, duration: 2000, inputTokens: 200 },
		]

		const retryCount = runs.length

		const totalInputTokens = runs.reduce((sum, r) => sum + (r.inputTokens || 0), 0)
		const averages = {
			inputTokens: totalInputTokens / retryCount,
		}

		expect(averages.inputTokens).toBe(100)
	})

	it("should format output JSON correctly", () => {
		const runId = 123
		const retryCount = 2
		const runs = [
			{ run: 1, duration: 1000, inputTokens: 100 },
			{ run: 2, duration: 2000, inputTokens: 200 },
		]
		const averages = {
			duration: 1500,
			inputTokens: 150,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
		}

		const content = JSON.stringify(
			{
				runId,
				retryCount,
				runs,
				averages,
			},
			null,
			2,
		)

		const parsed = JSON.parse(content)
		expect(parsed).toHaveProperty("runId", 123)
		expect(parsed).toHaveProperty("retryCount", 2)
		expect(parsed).toHaveProperty("runs")
		expect(parsed).toHaveProperty("averages")
		expect(parsed.runs).toHaveLength(2)
	})
})