import { render, screen, fireEvent } from "@/utils/test-utils"
import { SiliconCloud } from "../SiliconCloud"
import { ProviderSettings } from "@roo-code/types"
import { mergeSiliconCloudModels } from "@/utils/model-utils"

// Mock the VSCode webview toolkit components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		children,
		value,
		onInput,
		placeholder,
		className,
		"data-testid": dataTestId,
		type,
		...rest
	}: any) => (
		<div data-testid={dataTestId || "vscode-text-field"} className={className}>
			{children}
			<input
				type={type || "text"}
				value={value}
				onChange={(e) => onInput && onInput(e)}
				placeholder={placeholder}
				data-testid={dataTestId}
				{...rest}
			/>
		</div>
	),
	VSCodeDropdown: ({ children, value, onChange, "data-testid": dataTestId, ...rest }: any) => (
		<select
			data-testid={dataTestId || "vscode-dropdown"}
			value={value}
			onChange={(e) => onChange && onChange(e)}
			{...rest}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value, ...rest }: any) => (
		<option value={value} {...rest}>
			{children}
		</option>
	),
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"settings:providers.siliconcloud.entrypoint": "API Entrypoint",
				"settings:providers.siliconcloud.apiLineConfigs.china": "China",
				"settings:providers.siliconcloud.apiLineConfigs.chinaOverseas": "China Overseas",
				"settings:providers.siliconcloud.apiLineConfigs.international": "International",
				"settings:providers.siliconcloud.entrypointDescription": "Choose your SiliconCloud API entrypoint",
				"settings:providers.siliconcloud.apiKey": "API Key",
				"settings:placeholders.apiKey": "Enter your API key",
				"settings:providers.apiKeyStorageNotice": "Your API key is stored securely on your device.",
				"settings:providers.siliconcloud.getApiKey": "Get your API key from SiliconCloud",
				"settings:providers.customModel.contextWindow.label": "Context Window",
				"settings:providers.customModel.contextWindow.description":
					"Maximum number of tokens the model can process",
				"settings:placeholders.numbers.contextWindow": "e.g., 65536",
			}
			return translations[key] || key
		},
	}),
}))

// Mock the VSCodeButtonLink component
vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ children, href, title }: any) => (
		<a href={href} title={title} data-testid="vscode-button-link">
			{children}
		</a>
	),
}))

// Mock the ModelPicker component
vi.mock("../../ModelPicker", () => ({
	ModelPicker: ({
		apiConfiguration,
		setApiConfigurationField,
		models,
		modelIdKey,
		serviceName,
		_serviceUrl,
		_organizationAllowList,
		errorMessage,
	}: any) => (
		<div data-testid="model-picker">
			<span data-testid="model-picker-title">{serviceName}</span>
			<span data-testid="model-picker-model-count">{models ? Object.keys(models).length : 0}</span>
			<select
				data-testid="model-picker-select"
				value={apiConfiguration[modelIdKey]}
				onChange={(e) => setApiConfigurationField(modelIdKey, e.target.value)}>
				{models &&
					Object.keys(models).map((modelId) => (
						<option key={modelId} value={modelId}>
							{models[modelId].displayName}
						</option>
					))}
			</select>
			{errorMessage && <span data-testid="model-validation-error">{errorMessage}</span>}
		</div>
	),
}))

// Mock the model utils
vi.mock("@/utils/model-utils", () => ({
	mergeSiliconCloudModels: vi.fn((dynamic, presetModels) => presetModels || dynamic),
}))

// Mock the constants
vi.mock("../../constants", () => ({
	SILICON_CLOUD_MODELS_BY_API_LINE: {
		china: {
			"zai-org/GLM-4.6": {
				displayName: "GLM-4.6",
				contextWindow: 202752,
			},
		},
		international: {
			"zai-org/GLM-4.6": {
				displayName: "GLM-4.6",
				contextWindow: 202752,
			},
		},
	},
}))

// Mock the types
vi.mock("@roo-code/types", () => ({
	siliconCloudApiLineSchema: { options: ["china", "chinaOverseas", "international"] },
	siliconCloudApiLineConfigs: {
		china: { baseUrl: "https://api.siliconflow.cn/v1" },
		chinaOverseas: { baseUrl: "https://api-st.siliconflow.cn/v1" },
		international: { baseUrl: "https://api.siliconflow.com/v1" },
	},
	siliconCloudDefaultApiLine: "china",
	siliconCloudDefaultModelId: "zai-org/GLM-4.6",
	siliconCloudModels: {
		"zai-org/GLM-4.6": {
			displayName: "GLM-4.6",
			contextWindow: 202752,
			supportsReasoningBudget: true,
		},
	},
	openAiModelInfoSaneDefaults: {
		contextWindow: 65536,
		supportsPromptCache: false,
	},
}))

describe("SiliconCloud Component", () => {
	const mockSetApiConfigurationField = vi.fn()
	const mockOrganizationAllowList = {
		allowAll: true,
		providers: {},
	}
	const mockRouterModels = {
		openrouter: {},
		kilocode: {},
		glama: {},
		requesty: {},
		unbound: {},
		litellm: {},
		ollama: {},
		lmstudio: {},
		deepinfra: {},
		"io-intelligence": {},
		"vercel-ai-gateway": {},
		huggingface: {},
		ovhcloud: {},
		chutes: {},
		gemini: {},
		inception: {},
		roo: {},
		siliconcloud: {
			"custom-model": {
				displayName: "Custom Model",
				contextWindow: 131072,
				supportsPromptCache: false,
			},
		},
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Component Rendering", () => {
		it("should render correctly with basic props", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "china",
				siliconCloudApiKey: "",
				apiModelId: "zai-org/GLM-4.6",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					routerModels={mockRouterModels}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that all main sections are rendered
			expect(screen.getByText("API Key")).toBeInTheDocument()
			expect(screen.getByText("Your SiliconCloud API key")).toBeInTheDocument()
			expect(screen.getByTestId("vscode-dropdown")).toBeInTheDocument()
			expect(screen.getByTestId("model-picker")).toBeInTheDocument()
		})

		it("should show correct API line descriptions for different regions", () => {
			const chinaConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "china",
			}

			render(
				<SiliconCloud
					apiConfiguration={chinaConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// China API line description should be visible
			expect(screen.getByText(/api\.siliconflow\.cn/)).toBeInTheDocument()
		})

		it("should show different API line descriptions for international", () => {
			const internationalConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "international",
			}

			render(
				<SiliconCloud
					apiConfiguration={internationalConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// International API line description should be visible
			expect(screen.getByText(/api\.siliconflow\.com/)).toBeInTheDocument()
		})
	})

	describe("API Key Input", () => {
		it("should render API key input field", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiKey: "",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const apiKeyInput = screen.getByTestId("vscode-text-field")
			expect(apiKeyInput).toBeInTheDocument()

			const input = screen.getByRole("textbox")
			expect(input).toBeInTheDocument()
			expect(input).toHaveAttribute("placeholder", "Enter your API key")
		})

		it("should show current API key value", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiKey: "test-api-key-123",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const input = screen.getByRole("textbox")
			expect(input).toHaveValue("test-api-key-123")
		})

		it("should handle API key input changes", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiKey: "",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const input = screen.getByRole("textbox")
			fireEvent.change(input, { target: { value: "new-api-key" } })

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("siliconCloudApiKey", "new-api-key")
		})
	})

	describe("API Line Selection", () => {
		it("should render API line dropdown with all options", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "china",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const dropdown = screen.getByTestId("vscode-dropdown")
			expect(dropdown).toBeInTheDocument()

			const options = screen.getAllByRole("option")
			expect(options).toHaveLength(3) // china, chinaOverseas, international
			expect(options[0]).toHaveValue("china")
			expect(options[1]).toHaveValue("chinaOverseas")
			expect(options[2]).toHaveValue("international")
		})

		it("should show correct selected API line", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "international",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const dropdown = screen.getByTestId("vscode-dropdown")
			expect(dropdown).toHaveValue("international")
		})

		it("should handle API line changes", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "china",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const dropdown = screen.getByTestId("vscode-dropdown")
			fireEvent.change(dropdown, { target: { value: "international" } })

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("siliconCloudApiLine", "international")
		})
	})

	describe("Model Selection", () => {
		it("should render ModelPicker component", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "zai-org/GLM-4.6",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					routerModels={mockRouterModels}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			expect(screen.getByTestId("model-picker")).toBeInTheDocument()
		})

		it("should pass correct props to ModelPicker", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "zai-org/GLM-4.6",
				siliconCloudApiLine: "china",
			}

			const modelValidationError = "Invalid model"

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					routerModels={mockRouterModels}
					organizationAllowList={mockOrganizationAllowList}
					modelValidationError={modelValidationError}
				/>,
			)

			// The ModelPicker should receive the validation error
			expect(screen.getByTestId("model-picker")).toBeInTheDocument()
		})
	})

	describe("Custom Model Info", () => {
		it("should not show custom model context window for preset models", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "zai-org/GLM-4.6", // This is a preset model
				siliconCloudApiLine: "china",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Should not show custom model context window
			expect(screen.queryByText("Context Window")).not.toBeInTheDocument()
		})

		it("should show custom model context window for non-preset models", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "custom-model", // This is not a preset model
				siliconCloudApiLine: "international",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Should show custom model context window
			expect(screen.getByText("Context Window")).toBeInTheDocument()
			expect(screen.getByText("Maximum number of tokens the model can process")).toBeInTheDocument()
		})

		it("should show correct default value for custom model context window", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "custom-model",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const contextWindowInput = screen.getByTestId("custom-model-context-window-text-field")
			expect(contextWindowInput).toBeInTheDocument()

			const input = screen.getByTestId("custom-model-context-window")
			expect(input).toHaveValue("65536") // Default value from openAiModelInfoSaneDefaults
		})

		it("should handle context window input changes", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "custom-model",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const input = screen.getByTestId("custom-model-context-window")
			fireEvent.change(input, { target: { value: "131072" } })

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"siliconCloudCustomModelInfo",
				expect.objectContaining({
					contextWindow: 131072,
				}),
			)
		})

		it("should handle invalid context window input gracefully", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "custom-model",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const input = screen.getByTestId("custom-model-context-window")
			fireEvent.change(input, { target: { value: "invalid" } })

			// Should handle invalid input by falling back to default
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"siliconCloudCustomModelInfo",
				expect.objectContaining({
					contextWindow: 65536, // Default value
				}),
			)
		})
	})

	describe("Help Links", () => {
		it("should render help link for international API", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "international",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const link = screen.getByTestId("vscode-button-link")
			expect(link).toBeInTheDocument()
			expect(link).toHaveAttribute("href", "https://cloud.siliconflow.com/me/account/ak")
			expect(link).toHaveAttribute("title", "Get your API key from SiliconCloud")
		})

		it("should render different help links for different API lines", () => {
			const chinaConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "china",
			}

			render(
				<SiliconCloud
					apiConfiguration={chinaConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const link = screen.getByTestId("vscode-button-link")
			expect(link).toBeInTheDocument()
			expect(link).toHaveAttribute("href", "https://cloud.siliconflow.cn/me/account/ak")
		})

		it("should render China Overseas help link", () => {
			const overseasConfiguration: Partial<ProviderSettings> = {
				siliconCloudApiLine: "chinaOverseas",
			}

			render(
				<SiliconCloud
					apiConfiguration={overseasConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const link = screen.getByTestId("vscode-button-link")
			expect(link).toBeInTheDocument()
			expect(link).toHaveAttribute("href", "https://cloud.siliconflow.cn/me/account/ak")
		})
	})

	describe("Component Updates", () => {
		it("should update when apiConfiguration changes", () => {
			const initialConfig: Partial<ProviderSettings> = {
				siliconCloudApiKey: "old-key",
				siliconCloudApiLine: "china",
			}

			const { rerender } = render(
				<SiliconCloud
					apiConfiguration={initialConfig as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check initial state
			let input = screen.getByTestId("api-key")
			expect(input).toHaveValue("old-key")

			// Update with new configuration
			const updatedConfig: Partial<ProviderSettings> = {
				siliconCloudApiKey: "new-key",
				siliconCloudApiLine: "international",
			}

			rerender(
				<SiliconCloud
					apiConfiguration={updatedConfig as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check updated state
			input = screen.getByTestId("api-key")
			expect(input).toHaveValue("new-key")

			const dropdown = screen.getByTestId("vscode-dropdown")
			expect(dropdown).toHaveValue("international")
		})
	})

	describe("Error Handling", () => {
		it("should handle missing router models gracefully", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "zai-org/GLM-4.6",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					// routerModels is undefined
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Component should still render without crashing
			expect(screen.getByText("API Key")).toBeInTheDocument()
		})

		it("should handle empty API configuration gracefully", () => {
			render(
				<SiliconCloud
					apiConfiguration={{}}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Component should still render without crashing
			expect(screen.getByText("API Key")).toBeInTheDocument()
		})
	})

	describe("Integration with Router Models", () => {
		it("should merge static and dynamic models correctly", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				apiModelId: "zai-org/GLM-4.6",
				siliconCloudApiLine: "china",
			}

			render(
				<SiliconCloud
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					routerModels={mockRouterModels}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Verify mergeSiliconCloudModels was called
			expect(mergeSiliconCloudModels).toHaveBeenCalledWith(
				mockRouterModels.siliconcloud,
				apiConfiguration.siliconCloudApiLine,
			)
		})
	})
})
