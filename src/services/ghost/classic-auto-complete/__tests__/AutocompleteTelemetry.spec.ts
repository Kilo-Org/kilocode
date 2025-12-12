import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { AutocompleteTelemetry } from "../AutocompleteTelemetry"
import type { AutocompleteContext } from "../../types"

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn(),
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

describe("AutocompleteTelemetry", () => {
	let telemetry: AutocompleteTelemetry
	let mockCaptureEvent: ReturnType<typeof vi.fn>

	const mockContext: AutocompleteContext = {
		languageId: "typescript",
		modelId: "codestral",
		provider: "mistral",
	}

	beforeEach(() => {
		telemetry = new AutocompleteTelemetry()
		mockCaptureEvent = vi.fn()
		vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)
		vi.mocked(TelemetryService.instance.captureEvent).mockImplementation(mockCaptureEvent)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("captureUniqueSuggestionShown", () => {
		it("should capture event with correct properties", () => {
			telemetry.captureUniqueSuggestionShown(mockContext, 20, "llm")

			expect(mockCaptureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN,
				expect.objectContaining({
					languageId: "typescript",
					modelId: "codestral",
					provider: "mistral",
					suggestionLength: 20,
					source: "llm",
				}),
			)
		})

		it("should track source correctly for cache hits", () => {
			telemetry.captureUniqueSuggestionShown(mockContext, 20, "cache")

			expect(mockCaptureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN,
				expect.objectContaining({
					source: "cache",
				}),
			)
		})

		it("should track source correctly for llm", () => {
			telemetry.captureUniqueSuggestionShown(mockContext, 15, "llm")

			expect(mockCaptureEvent).toHaveBeenCalledWith(
				TelemetryEventName.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN,
				expect.objectContaining({
					source: "llm",
					suggestionLength: 15,
				}),
			)
		})
	})
})
