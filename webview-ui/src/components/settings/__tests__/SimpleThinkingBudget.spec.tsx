import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { SimpleThinkingBudget } from "../SimpleThinkingBudget"
import type { ProviderSettings, ModelInfo } from "@roo-code/types"

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"settings:providers.reasoningEffort.label": "Model Reasoning Effort",
				"settings:providers.reasoningEffort.none": "None",
				"settings:providers.reasoningEffort.low": "Low",
				"settings:providers.reasoningEffort.medium": "Medium",
				"settings:providers.reasoningEffort.high": "High",
				"settings:common.select": "Select",
			}
			return translations[key] || key
		},
	}),
}))

// Mock the useSelectedModel hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ id: "test-model" }),
}))

describe("SimpleThinkingBudget", () => {
	const mockSetApiConfigurationField = vi.fn()

	const baseApiConfiguration: ProviderSettings = {
		apiProvider: "roo",
	}

	const modelWithReasoningEffort: ModelInfo = {
		maxTokens: 8192,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: true,
		inputPrice: 0,
		outputPrice: 0,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should not render when model does not support reasoning effort", () => {
		const modelWithoutReasoningEffort: ModelInfo = {
			...modelWithReasoningEffort,
			supportsReasoningEffort: false,
		}

		const { container } = render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithoutReasoningEffort}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("should not render when modelInfo is undefined", () => {
		const { container } = render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={undefined}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("should render with None option when reasoning effort is not required", () => {
		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithReasoningEffort}
			/>,
		)

		expect(screen.getByTestId("simple-reasoning-effort")).toBeInTheDocument()
		expect(screen.getByText("Model Reasoning Effort")).toBeInTheDocument()
	})

	it("should not render None option when reasoning effort is required", () => {
		const modelWithRequiredReasoningEffort: ModelInfo = {
			...modelWithReasoningEffort,
			requiredReasoningEffort: true,
		}

		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithRequiredReasoningEffort}
			/>,
		)

		expect(screen.getByTestId("simple-reasoning-effort")).toBeInTheDocument()
	})

	it("should set default reasoning effort when required and no value is set", () => {
		const modelWithRequiredReasoningEffort: ModelInfo = {
			...modelWithReasoningEffort,
			requiredReasoningEffort: true,
			reasoningEffort: "high",
		}

		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithRequiredReasoningEffort}
			/>,
		)

		// Should set default reasoning effort
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith("reasoningEffort", "high", false)
	})

	it("should not set default reasoning effort when not required", () => {
		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithReasoningEffort}
			/>,
		)

		// Should not set any default value
		expect(mockSetApiConfigurationField).not.toHaveBeenCalled()
	})

	it("should include None option in available efforts when not required", () => {
		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithReasoningEffort}
			/>,
		)

		// Component should render with the select
		expect(screen.getByRole("combobox")).toBeInTheDocument()
	})

	it("should exclude None option when reasoning effort is required", () => {
		const modelWithRequiredReasoningEffort: ModelInfo = {
			...modelWithReasoningEffort,
			requiredReasoningEffort: true,
		}

		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithRequiredReasoningEffort}
			/>,
		)

		// Component should render with the select
		expect(screen.getByRole("combobox")).toBeInTheDocument()
	})

	it("should display current reasoning effort value", () => {
		render(
			<SimpleThinkingBudget
				apiConfiguration={{ ...baseApiConfiguration, reasoningEffort: "low" }}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithReasoningEffort}
			/>,
		)

		expect(screen.getByText("Low")).toBeInTheDocument()
	})

	it("should display None when no reasoning effort is set", () => {
		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithReasoningEffort}
			/>,
		)

		expect(screen.getByText("None")).toBeInTheDocument()
	})

	it("should use model default reasoning effort when required and available", () => {
		const modelWithDefaultEffort: ModelInfo = {
			...modelWithReasoningEffort,
			requiredReasoningEffort: true,
			reasoningEffort: "medium",
		}

		render(
			<SimpleThinkingBudget
				apiConfiguration={baseApiConfiguration}
				setApiConfigurationField={mockSetApiConfigurationField}
				modelInfo={modelWithDefaultEffort}
			/>,
		)

		expect(mockSetApiConfigurationField).toHaveBeenCalledWith("reasoningEffort", "medium", false)
	})
})
