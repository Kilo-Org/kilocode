// kilocode_change - new file
import { AutocompleteTelemetry, MIN_VISIBILITY_DURATION_MS, getSuggestionKey } from "../AutocompleteTelemetry"
import type { AutocompleteContext, FillInAtCursorSuggestion } from "../../types"

describe("AutocompleteTelemetry", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	/**
	 * Helper to create a FillInAtCursorSuggestion with a unique key
	 */
	function createSuggestion(index: number): FillInAtCursorSuggestion {
		return {
			text: `text-${index}`,
			prefix: `prefix-${index}`,
			suffix: `suffix-${index}`,
		}
	}

	test("caps fired unique telemetry keys to the 50 most recent", () => {
		const telemetry = new AutocompleteTelemetry()

		// Keep it minimal; the implementation only spreads this object.
		const context = {
			languageId: "typescript",
			modelId: "test-model",
			provider: "test-provider",
		} as unknown as AutocompleteContext

		for (let i = 0; i < 60; i++) {
			telemetry.startVisibilityTracking(createSuggestion(i), "llm", context)
			vi.advanceTimersByTime(MIN_VISIBILITY_DURATION_MS)
		}

		const firedMap = (telemetry as any).firedUniqueTelemetryKeys as Map<string, true>

		expect(firedMap.size).toBe(50)
		expect(firedMap.has(getSuggestionKey(createSuggestion(0)))).toBe(false)
		expect(firedMap.has(getSuggestionKey(createSuggestion(9)))).toBe(false)
		expect(firedMap.has(getSuggestionKey(createSuggestion(10)))).toBe(true)
		expect(firedMap.has(getSuggestionKey(createSuggestion(59)))).toBe(true)
	})

	test("evicted keys can be tracked again later", () => {
		const telemetry = new AutocompleteTelemetry()

		const context = {} as AutocompleteContext

		// Fill and overflow the map so key-0 is evicted
		for (let i = 0; i < 60; i++) {
			telemetry.startVisibilityTracking(createSuggestion(i), "llm", context)
			vi.advanceTimersByTime(MIN_VISIBILITY_DURATION_MS)
		}

		let firedMap = (telemetry as any).firedUniqueTelemetryKeys as Map<string, true>
		expect(firedMap.has(getSuggestionKey(createSuggestion(0)))).toBe(false)

		// Now key-0 should be eligible again
		telemetry.startVisibilityTracking(createSuggestion(0), "llm", context)
		vi.advanceTimersByTime(MIN_VISIBILITY_DURATION_MS)

		firedMap = (telemetry as any).firedUniqueTelemetryKeys as Map<string, true>
		expect(firedMap.has(getSuggestionKey(createSuggestion(0)))).toBe(true)
		expect(firedMap.size).toBe(50)
	})
})
