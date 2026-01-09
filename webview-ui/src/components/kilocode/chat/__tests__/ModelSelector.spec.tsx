import { render, screen } from "@/utils/test-utils"
import { ModelSelector } from "../ModelSelector"
import type { ProviderSettings } from "@roo-code/types"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Create a mock function that can be controlled per test
const mockUseGroupedModelIds = vi.fn()

vi.mock("@/components/ui/hooks/kilocode/usePreferredModels", () => ({
	useGroupedModelIds: () => mockUseGroupedModelIds(),
}))

// Create a mock function that can be controlled per test
const mockUseProviderModels = vi.fn()

vi.mock("../../hooks/useProviderModels", () => ({
	useProviderModels: (config: ProviderSettings) => mockUseProviderModels(config),
}))

vi.mock("../../hooks/useSelectedModel", () => ({
	getSelectedModelId: () => "model-1",
	getModelIdKey: () => "apiModelId",
}))

describe("ModelSelector", () => {
	const baseApiConfiguration: ProviderSettings = {
		apiProvider: "openai",
		apiModelId: "model-1",
	}

	beforeEach(() => {
		// Reset mocks before each test
		mockUseProviderModels.mockReset()
		mockUseGroupedModelIds.mockReset()

		// Default mock implementation for useGroupedModelIds (no preferred models)
		mockUseGroupedModelIds.mockReturnValue({
			preferredModelIds: [],
			restModelIds: ["model-1", "model-2"],
		})

		// Default mock implementation for useProviderModels
		mockUseProviderModels.mockReturnValue({
			provider: "openai",
			providerModels: {
				"model-1": { displayName: "Model 1" },
				"model-2": { displayName: "Model 2" },
			},
			providerDefaultModel: "model-1",
			isLoading: false,
			isError: false,
		})
	})

	test("renders dropdown for chat profile", () => {
		const chatConfig: ProviderSettings = {
			...baseApiConfiguration,
			profileType: "chat",
		}

		render(
			<ModelSelector
				currentApiConfigName="test-profile"
				apiConfiguration={chatConfig}
				fallbackText="Select a model"
			/>,
		)

		// Should render the SelectDropdown component (not a span)
		// The SelectDropdown renders as a button with data-testid="dropdown-trigger"
		const dropdownTrigger = screen.getByTestId("dropdown-trigger")
		expect(dropdownTrigger).toBeInTheDocument()
		expect(dropdownTrigger.tagName).toBe("BUTTON")
	})

	test("renders disabled span for autocomplete profile", () => {
		const autocompleteConfig: ProviderSettings = {
			...baseApiConfiguration,
			profileType: "autocomplete",
		}

		render(
			<ModelSelector
				currentApiConfigName="test-profile"
				apiConfiguration={autocompleteConfig}
				fallbackText="Select a model"
			/>,
		)

		// Should render a span with fallback text (not a dropdown)
		expect(screen.getByText("Select a model")).toBeInTheDocument()

		// Should NOT render the SelectDropdown component
		const dropdownTrigger = screen.queryByTestId("dropdown-trigger")
		expect(dropdownTrigger).not.toBeInTheDocument()
	})

	test("renders disabled span when isError is true", () => {
		mockUseProviderModels.mockReturnValue({
			provider: "openai",
			providerModels: {},
			providerDefaultModel: undefined,
			isLoading: false,
			isError: true,
		})

		render(
			<ModelSelector
				currentApiConfigName="test-profile"
				apiConfiguration={baseApiConfiguration}
				fallbackText="Error loading models"
			/>,
		)

		expect(screen.getByText("Error loading models")).toBeInTheDocument()

		const dropdownTrigger = screen.queryByTestId("dropdown-trigger")
		expect(dropdownTrigger).not.toBeInTheDocument()
	})

	test("renders nothing when isLoading is true", () => {
		mockUseProviderModels.mockReturnValue({
			provider: "openai",
			providerModels: {},
			providerDefaultModel: undefined,
			isLoading: true,
			isError: false,
		})

		const { container } = render(
			<ModelSelector
				currentApiConfigName="test-profile"
				apiConfiguration={baseApiConfiguration}
				fallbackText="Loading..."
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	test("renders span for virtual-quota-fallback provider with virtualQuotaActiveModel", () => {
		mockUseProviderModels.mockReturnValue({
			provider: "virtual-quota-fallback",
			providerModels: {},
			providerDefaultModel: undefined,
			isLoading: false,
			isError: false,
		})

		const virtualQuotaConfig: ProviderSettings = {
			...baseApiConfiguration,
			apiProvider: "virtual-quota-fallback",
		}

		render(
			<ModelSelector
				currentApiConfigName="test-profile"
				apiConfiguration={virtualQuotaConfig}
				fallbackText="Select a model"
				virtualQuotaActiveModel={{ id: "gpt-4", name: "GPT-4" }}
			/>,
		)

		// Should show the virtual quota active model name (prettyModelName formats it)
		expect(screen.getByText("Gpt 4")).toBeInTheDocument()

		const dropdownTrigger = screen.queryByTestId("dropdown-trigger")
		expect(dropdownTrigger).not.toBeInTheDocument()
	})

	test("autocomplete profile takes precedence over other conditions", () => {
		// Even with valid models, autocomplete profile should show disabled span
		const autocompleteConfig: ProviderSettings = {
			...baseApiConfiguration,
			profileType: "autocomplete",
		}

		render(
			<ModelSelector
				currentApiConfigName="test-profile"
				apiConfiguration={autocompleteConfig}
				fallbackText="Autocomplete model"
			/>,
		)

		expect(screen.getByText("Autocomplete model")).toBeInTheDocument()

		const dropdownTrigger = screen.queryByTestId("dropdown-trigger")
		expect(dropdownTrigger).not.toBeInTheDocument()
	})

	describe("preferred models sections", () => {
		test("builds options with section headers when preferred models exist", () => {
			// Setup mock to return preferred models
			mockUseGroupedModelIds.mockReturnValue({
				preferredModelIds: ["preferred-1", "preferred-2"],
				restModelIds: ["model-1", "model-2"],
			})

			mockUseProviderModels.mockReturnValue({
				provider: "openai",
				providerModels: {
					"preferred-1": { displayName: "Preferred Model 1", preferredIndex: 0 },
					"preferred-2": { displayName: "Preferred Model 2", preferredIndex: 1 },
					"model-1": { displayName: "Model 1" },
					"model-2": { displayName: "Model 2" },
				},
				providerDefaultModel: "model-1",
				isLoading: false,
				isError: false,
			})

			render(
				<ModelSelector
					currentApiConfigName="test-profile"
					apiConfiguration={{
						apiProvider: "openai",
						apiModelId: "model-1",
					}}
					fallbackText="Select a model"
				/>,
			)

			// Should render the dropdown
			const dropdownTrigger = screen.getByTestId("dropdown-trigger")
			expect(dropdownTrigger).toBeInTheDocument()
		})

		test("does not add section headers when no preferred models exist", () => {
			// Setup mock with no preferred models
			mockUseGroupedModelIds.mockReturnValue({
				preferredModelIds: [],
				restModelIds: ["model-1", "model-2"],
			})

			render(
				<ModelSelector
					currentApiConfigName="test-profile"
					apiConfiguration={{
						apiProvider: "openai",
						apiModelId: "model-1",
					}}
					fallbackText="Select a model"
				/>,
			)

			// Should render the dropdown
			const dropdownTrigger = screen.getByTestId("dropdown-trigger")
			expect(dropdownTrigger).toBeInTheDocument()
		})

		test("handles only preferred models without rest models", () => {
			// Setup mock with only preferred models (edge case)
			mockUseGroupedModelIds.mockReturnValue({
				preferredModelIds: ["preferred-1"],
				restModelIds: [],
			})

			mockUseProviderModels.mockReturnValue({
				provider: "openai",
				providerModels: {
					"preferred-1": { displayName: "Preferred Model 1", preferredIndex: 0 },
				},
				providerDefaultModel: "preferred-1",
				isLoading: false,
				isError: false,
			})

			render(
				<ModelSelector
					currentApiConfigName="test-profile"
					apiConfiguration={{
						apiProvider: "openai",
						apiModelId: "preferred-1",
					}}
					fallbackText="Select a model"
				/>,
			)

			// Should render the dropdown with only preferred models section
			const dropdownTrigger = screen.getByTestId("dropdown-trigger")
			expect(dropdownTrigger).toBeInTheDocument()
		})
	})
})
