// kilocode_change - new file
import React from "react"
import { render, screen, fireEvent, waitFor, act } from "@/utils/test-utils"
import SapAiCore from "../SapAiCore"
import type { ProviderSettings } from "@roo-code/types"
import type { ModelRecord } from "@roo/api"
import { DeploymentRecord } from "../../../../../../src/api/providers/fetchers/sap-ai-core"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock UI components
vi.mock("@src/components/ui", () => ({
	Checkbox: (props: any) => {
		const { id, checked, onCheckedChange, children, ...restProps } = props
		return (
			<label data-testid={`checkbox-${id}`}>
				<input
					type="checkbox"
					checked={checked}
					onChange={() => onCheckedChange?.(!checked)}
					data-testid={`checkbox-input-${id}`}
					{...restProps}
				/>
				{children}
			</label>
		)
	},
	Input: React.forwardRef((props: any, ref: any) => {
		const { id, value, onInput, type, placeholder, ...restProps } = props
		return (
			<input
				ref={ref}
				id={id}
				type={type}
				value={value || ""}
				onChange={(e: any) => onInput?.(e)}
				placeholder={placeholder}
				data-testid={id}
				{...restProps}
			/>
		)
	}),
	SearchableSelect: (props: any) => {
		const { value, onValueChange, options, placeholder, disabled, "data-testid": testId } = props
		return (
			<select
				value={value || ""}
				onChange={(e: any) => onValueChange?.(e.target.value)}
				disabled={disabled}
				data-testid={testId || "searchable-select"}>
				<option value="">{placeholder}</option>
				{options?.map((option: any) => (
					<option key={option.value} value={option.value} disabled={option.disabled}>
						{option.label}
					</option>
				))}
			</select>
		)
	},
}))

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: (props: any) => {
		const { children, href, target } = props
		return (
			<a href={href} target={target} data-testid="vscode-link">
				{children}
			</a>
		)
	},
}))

// Mock ModelInfoView component
vi.mock("@/components/settings/ModelInfoView", () => ({
	ModelInfoView: (props: any) => {
		const { isDescriptionExpanded, setIsDescriptionExpanded } = props
		return (
			<div data-testid="model-info-view">
				<button
					onClick={() => setIsDescriptionExpanded?.(!isDescriptionExpanded)}
					data-testid="model-info-toggle">
					Model Info View
				</button>
			</div>
		)
	},
}))

// Mock transforms
vi.mock("../transforms", () => ({
	inputEventTransform: (event: any) => event.target?.value || event,
}))

// Mock translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: any) => {
			if (options?.count !== undefined) {
				return `${key} (${options.count})`
			}
			return key
		},
	}),
}))

// Mock react-use
let mockMessageHandler: ((event: MessageEvent) => void) | null = null
vi.mock("react-use", () => ({
	useEvent: vi.fn((eventType: string, handler: (event: MessageEvent) => void) => {
		if (eventType === "message") {
			mockMessageHandler = handler
		}
	}),
}))

describe("SapAiCore Component", () => {
	// Define all shared variables inside the describe block
	const defaultApiConfiguration: Partial<ProviderSettings> = {
		sapAiCoreServiceKey: "",
		sapAiCoreResourceGroup: "",
		sapAiCoreUseOrchestration: false,
		sapAiCoreModelId: "",
		sapAiCoreDeploymentId: "",
		apiProvider: "sap-ai-core",
	}

	const mockSetApiConfigurationField = vi.fn()
	let mockPostMessage: any

	beforeAll(async () => {
		// Get the mocked postMessage function
		const { vscode } = await import("@src/utils/vscode")
		mockPostMessage = vscode.postMessage
	})

	// Helper function to simulate message events
	const simulateMessageEvent = (data: any) => {
		if (mockMessageHandler) {
			const event = { data } as MessageEvent
			mockMessageHandler(event)
		}
	}

	const mockModels: ModelRecord = {
		"gpt-4o-mini": {
			maxTokens: 4096,
			contextWindow: 32768,
			supportsImages: true,
			supportsComputerUse: false,
			supportsPromptCache: true,
			supportsVerbosity: false,
			supportsReasoningBudget: false,
			supportsTemperature: true,
			requiredReasoningBudget: false,
			supportsReasoningEffort: false,
			supportedParameters: ["max_tokens", "temperature"],
			inputPrice: 0.00015,
			outputPrice: 0.0006,
			description: "GPT-4o mini model for testing",
			displayName: "GPT-4o Mini",
			preferredIndex: 1,
		},
		"gpt-4o": {
			maxTokens: 4096,
			contextWindow: 128000,
			supportsImages: true,
			supportsComputerUse: true,
			supportsPromptCache: true,
			supportsVerbosity: false,
			supportsReasoningBudget: false,
			supportsTemperature: true,
			requiredReasoningBudget: false,
			supportsReasoningEffort: false,
			supportedParameters: ["max_tokens", "temperature"],
			inputPrice: 0.005,
			outputPrice: 0.015,
			cacheWritesPrice: 0.00625,
			cacheReadsPrice: 0.00125,
			description: "GPT-4o model for testing",
			displayName: "GPT-4o",
			preferredIndex: 2,
		},
	}

	const mockDeployments: DeploymentRecord = {
		"deployment-1": {
			id: "deployment-1",
			name: "GPT-4o Mini Deployment 1",
			model: "gpt-4o-mini",
			targetStatus: "RUNNING",
		},
		"deployment-2": {
			id: "deployment-2",
			name: "GPT-4o Deployment 2",
			model: "gpt-4o",
			targetStatus: "STOPPED",
		},
		"deployment-3": {
			id: "deployment-3",
			name: "GPT-4o Deployment 3",
			model: "gpt-4o",
			targetStatus: "RUNNING",
		},
	}

	const mockDeploymentsWithoutGpt4o: DeploymentRecord = {
		"deployment-1": {
			id: "deployment-1",
			name: "GPT-4o Mini Deployment 1",
			model: "gpt-4o-mini",
			targetStatus: "RUNNING",
		},
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Initial Rendering", () => {
		it("should render all input fields with correct labels", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.getByLabelText("settings:providers.sapAiCore.serviceKey")).toBeInTheDocument()
			expect(screen.getByLabelText("settings:providers.sapAiCore.resourceGroup")).toBeInTheDocument()
		})

		it("should render orchestration checkbox unchecked by default", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const checkbox = screen.getByTestId("checkbox-sap-ai-core-orchestration")
			expect(checkbox).not.toBeChecked()
		})

		it("should render model selector", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.getByTestId("searchable-select")).toBeInTheDocument()
		})

		it("should render VSCode links", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const links = screen.getAllByTestId("vscode-link")
			expect(links).toHaveLength(3) // credentials note, orchestration note, and get started
		})
	})

	describe("Input Field Behavior", () => {
		it("should call setApiConfigurationField when input values change", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const serviceKeyInput = screen.getByTestId("sap-ai-core-service-key")

			await act(async () => {
				fireEvent.change(serviceKeyInput, { target: { value: "test-service-key" } })
			})

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreServiceKey", "test-service-key")
		})

		it("should trigger model and deployment fetch when refetch fields change", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const serviceKeyInput = screen.getByTestId("sap-ai-core-service-key")
			await act(async () => {
				fireEvent.change(serviceKeyInput, { target: { value: "test" } })
			})

			// Should trigger initial fetch on mount and then again on input change
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "requestSapAiCoreModels",
				values: expect.any(Object),
			})
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "requestSapAiCoreDeployments",
				values: expect.any(Object),
			})
		})
	})

	describe("Orchestration Mode", () => {
		it("should toggle orchestration mode when checkbox is clicked", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const checkbox = screen.getByTestId("checkbox-input-sap-ai-core-orchestration")
			await act(async () => {
				fireEvent.click(checkbox)
			})

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreUseOrchestration", true)
		})

		it("should clear model-related fields when toggling orchestration", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreModelId: "gpt-4o-mini",
				sapAiCoreDeploymentId: "deployment-1",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const checkbox = screen.getByTestId("checkbox-input-sap-ai-core-orchestration")
			await act(async () => {
				fireEvent.click(checkbox)
			})

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreModelId", undefined)
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreCustomModelInfo", undefined)
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreDeploymentId", undefined)
		})

		it("should show warning message when orchestration is disabled", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.getByText("settings:providers.sapAiCore.supportedProviders")).toBeInTheDocument()
			expect(screen.getByText("settings:providers.sapAiCore.supportedProvidersDesc1")).toBeInTheDocument()
		})

		it("should hide warning message when orchestration is enabled", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: true,
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.queryByText("settings:providers.sapAiCore.supportedProviders")).not.toBeInTheDocument()
		})
	})

	describe("Model Deployment Description", () => {
		it("should show model deployment description when orchestration is disabled and no model is selected", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.getByText("settings:providers.sapAiCore.modelDeploymentDesc")).toBeInTheDocument()
		})

		it("should hide model deployment description when orchestration is enabled", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: true,
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.queryByText("settings:providers.sapAiCore.modelDeploymentDesc")).not.toBeInTheDocument()
		})

		it("should hide model deployment description when model is selected", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.queryByText("settings:providers.sapAiCore.modelDeploymentDesc")).not.toBeInTheDocument()
		})
	})

	describe("Model Selection", () => {
		it("should simulate receiving models from message handler", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Simulate message event using our helper
			simulateMessageEvent({
				type: "sapAiCoreModels",
				sapAiCoreModels: mockModels,
			})

			// Wait for the models to be processed and check they are displayed
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (2)")).toBeInTheDocument()
			})
		})

		it("should handle model selection", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Simulate loading models
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreModels",
					sapAiCoreModels: mockModels,
				})
			})

			// Wait for models to be loaded
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (2)")).toBeInTheDocument()
			})

			// Clear previous mock calls from initialization
			mockSetApiConfigurationField.mockClear()

			// Find and select a model
			const modelSelect = screen.getByTestId("searchable-select")
			await act(async () => {
				fireEvent.change(modelSelect, { target: { value: "gpt-4o-mini" } })
			})

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreModelId", "gpt-4o-mini")
		})

		it("should disable models without any deployments when orchestration is disabled", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load models and deployments (using deployment data where gpt-4o has no deployments at all)
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreModels",
					sapAiCoreModels: mockModels,
				})
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeploymentsWithoutGpt4o,
				})
			})

			// Wait for models to be loaded
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (2)")).toBeInTheDocument()
			})

			// Check that the model selector has options with correct disabled states
			const modelSelect = screen.getByTestId("searchable-select")
			const options = modelSelect.querySelectorAll("option")

			// Find the gpt-4o option (should be disabled as it has no deployments)
			const gpt4oOption = Array.from(options).find((option) => option.getAttribute("value") === "gpt-4o")
			expect(gpt4oOption).toHaveProperty("disabled", true)

			// Find the gpt-4o-mini option (should be enabled as it has a deployment)
			const gpt4oMiniOption = Array.from(options).find((option) => option.getAttribute("value") === "gpt-4o-mini")
			expect(gpt4oMiniOption).toHaveProperty("disabled", false)
		})

		it("should enable all models when orchestration is enabled", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: true,
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load models and deployments
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreModels",
					sapAiCoreModels: mockModels,
				})
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Wait for models to be loaded
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (2)")).toBeInTheDocument()
			})

			// Check that all models are enabled when orchestration is on
			const modelSelect = screen.getByTestId("searchable-select")
			const options = modelSelect.querySelectorAll("option")

			// All model options should be enabled (not disabled)
			const modelOptions = Array.from(options).filter((option) => option.getAttribute("value") !== "")
			modelOptions.forEach((option) => {
				expect(option).not.toHaveAttribute("disabled")
			})
		})

		it("should set model info when model is selected", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load models
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreModels",
					sapAiCoreModels: mockModels,
				})
			})

			// Clear previous mock calls
			mockSetApiConfigurationField.mockClear()

			// Select a model
			const modelSelect = screen.getByTestId("searchable-select")
			await act(async () => {
				fireEvent.change(modelSelect, { target: { value: "gpt-4o-mini" } })
			})

			// Should set both model ID and custom model info
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreModelId", "gpt-4o-mini")
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"sapAiCoreCustomModelInfo",
				mockModels["gpt-4o-mini"],
			)
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreDeploymentId", undefined)
		})
	})

	describe("Deployment Selection", () => {
		it("should not show deployment selector when orchestration is enabled", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: true,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Should not show deployment selector when orchestration is enabled
			expect(screen.queryByText("settings:providers.sapAiCore.deployment")).not.toBeInTheDocument()
		})

		it("should not show deployment selector when no model is selected", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Should not show deployment selector when no model is selected
			expect(screen.queryByText("settings:providers.sapAiCore.deployment")).not.toBeInTheDocument()
		})

		it("should show deployment selector when orchestration is disabled and model is selected", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load deployments
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Should show deployment selector
			expect(screen.getByText("settings:providers.sapAiCore.deployment")).toBeInTheDocument()
		})

		it("should show deployment count for selected model", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load deployments
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Should show deployment count (1 deployment for gpt-4o-mini)
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.deploymentsCount (1)")).toBeInTheDocument()
			})
		})

		it("should handle deployment selection", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load deployments
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Wait for deployment selector to appear
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.deployment")).toBeInTheDocument()
			})

			// Clear previous mock calls
			mockSetApiConfigurationField.mockClear()

			// Find the deployment selector (it should be the second SearchableSelect)
			const selects = screen.getAllByTestId("searchable-select")
			const deploymentSelect = selects[1] // Second select is deployment select

			await act(async () => {
				fireEvent.change(deploymentSelect, { target: { value: "deployment-1" } })
			})

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreDeploymentId", "deployment-1")
		})

		it("should disable deployment selector when no deployments are available for selected model", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
				sapAiCoreModelId: "model-without-deployments",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load deployments (none for this model)
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Wait for deployment selector to appear
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.deployment")).toBeInTheDocument()
			})

			// Find the deployment selector
			const selects = screen.getAllByTestId("searchable-select")
			const deploymentSelect = selects[1]

			expect(deploymentSelect).toBeDisabled()
		})

		it("should show correct placeholder text based on deployment availability", async () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreUseOrchestration: false,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			const { rerender } = render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Load deployments
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Should show "Select a deployment..." placeholder
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.selectDeployment")).toBeInTheDocument()
			})

			// Change to model without deployments
			const noDeploymentConfig = {
				...apiConfiguration,
				sapAiCoreModelId: "model-without-deployments",
			}

			rerender(
				<SapAiCore
					apiConfiguration={noDeploymentConfig as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Should show "No deployment found" placeholder
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.noDeploymentFound")).toBeInTheDocument()
			})
		})
	})

	describe("Loading States", () => {
		it("should show loading state for models", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.getByText("settings:providers.sapAiCore.loading")).toBeInTheDocument()
		})

		it("should disable model selector during loading", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const modelSelect = screen.getByTestId("searchable-select")
			expect(modelSelect).toBeDisabled()
		})

		it("should show model count when models are loaded", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			simulateMessageEvent({
				type: "sapAiCoreModels",
				sapAiCoreModels: mockModels,
			})

			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (2)")).toBeInTheDocument()
			})
		})
	})

	describe("ModelInfoView Integration", () => {
		it("should show ModelInfoView when model is selected", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.getByTestId("model-info-view")).toBeInTheDocument()
		})

		it("should hide ModelInfoView when no model is selected", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			expect(screen.queryByTestId("model-info-view")).not.toBeInTheDocument()
		})

		it("should handle description expansion toggle", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				sapAiCoreModelId: "gpt-4o-mini",
			}

			render(
				<SapAiCore
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const toggleButton = screen.getByTestId("model-info-toggle")
			fireEvent.click(toggleButton)

			// The component should handle the state change internally
			expect(toggleButton).toBeInTheDocument()
		})
	})

	describe("Edge Cases and Error Handling", () => {
		it("should handle empty models response", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			simulateMessageEvent({
				type: "sapAiCoreModels",
				sapAiCoreModels: {},
			})

			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (0)")).toBeInTheDocument()
			})
		})

		it("should handle empty deployments response", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			simulateMessageEvent({
				type: "sapAiCoreDeployments",
				sapAiCoreDeployments: {},
			})

			// Since the current implementation doesn't show deployment counts,
			// just verify component doesn't crash
			expect(screen.getByTestId("searchable-select")).toBeInTheDocument()
		})

		it("should handle undefined models response", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			simulateMessageEvent({
				type: "sapAiCoreModels",
				sapAiCoreModels: undefined,
			})

			// Should handle gracefully without crashing
			expect(screen.getByTestId("searchable-select")).toBeInTheDocument()
		})

		it("should handle undefined deployments response", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			simulateMessageEvent({
				type: "sapAiCoreDeployments",
				sapAiCoreDeployments: undefined,
			})

			// Should handle gracefully without crashing - only check for main model selector
			expect(screen.getByTestId("searchable-select")).toBeInTheDocument()
		})

		it("should handle unknown message types", () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Should not crash on unknown message type
			simulateMessageEvent({
				type: "unknownMessageType",
				data: "some data",
			})

			expect(screen.getByTestId("searchable-select")).toBeInTheDocument()
		})
	})

	describe("Component Integration", () => {
		it("should handle complete workflow", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Fill in credentials
			const serviceKeyInput = screen.getByTestId("sap-ai-core-service-key")
			await act(async () => {
				fireEvent.change(serviceKeyInput, { target: { value: "test-service-key" } })
			})

			// Load models and deployments
			await act(async () => {
				simulateMessageEvent({
					type: "sapAiCoreModels",
					sapAiCoreModels: mockModels,
				})
				simulateMessageEvent({
					type: "sapAiCoreDeployments",
					sapAiCoreDeployments: mockDeployments,
				})
			})

			// Wait for models to be loaded
			await waitFor(() => {
				expect(screen.getByText("settings:providers.sapAiCore.modelsCount (2)")).toBeInTheDocument()
			})

			// Clear previous mock calls to focus on the model selection
			mockSetApiConfigurationField.mockClear()

			// Select a model
			const modelSelect = screen.getByTestId("searchable-select")
			await act(async () => {
				fireEvent.change(modelSelect, { target: { value: "gpt-4o-mini" } })
			})

			// Verify model selection was called
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("sapAiCoreModelId", "gpt-4o-mini")
		})

		it("should properly handle refetch triggers", async () => {
			render(
				<SapAiCore
					apiConfiguration={defaultApiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Clear the initial fetch calls
			mockPostMessage.mockClear()

			// Change a refetch field
			const resourceGroupInput = screen.getByTestId("sap-ai-core-resource-group")
			fireEvent.change(resourceGroupInput, { target: { value: "test-group" } })

			// Should trigger new fetches
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "requestSapAiCoreModels",
				values: expect.any(Object),
			})
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "requestSapAiCoreDeployments",
				values: expect.any(Object),
			})
		})
	})
})
