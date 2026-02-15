import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { convertHeadersToObject } from "./utils/headers"
import { useDebounce } from "react-use"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
// import { ExternalLinkIcon } from "@radix-ui/react-icons" // kilocode_change

import {
	type ProviderName,
	type ProviderSettings,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
	openRouterDefaultModelId,
	zenmuxDefaultModelId, // kilocode_change
	requestyDefaultModelId,
	glamaDefaultModelId, // kilocode_change
	unboundDefaultModelId,
	litellmDefaultModelId,
	openAiNativeDefaultModelId,
	openAiCodexDefaultModelId,
	anthropicDefaultModelId,
	doubaoDefaultModelId,
	claudeCodeDefaultModelId,
	qwenCodeDefaultModelId,
	geminiDefaultModelId,
	deepSeekDefaultModelId,
	moonshotDefaultModelId,
	// kilocode_change start
	apertisDefaultModelId,
	syntheticDefaultModelId,
	ovhCloudAiEndpointsDefaultModelId,
	inceptionDefaultModelId,
	MODEL_SELECTION_ENABLED,
	// kilocode_change end
	mistralDefaultModelId,
	xaiDefaultModelId,
	groqDefaultModelId,
	cerebrasDefaultModelId,
	chutesDefaultModelId,
	basetenDefaultModelId,
	corethinkDefaultModelId,
	bedrockDefaultModelId,
	vertexDefaultModelId,
	sambaNovaDefaultModelId,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	fireworksDefaultModelId,
	featherlessDefaultModelId,
	ioIntelligenceDefaultModelId,
	rooDefaultModelId,
	vercelAiGatewayDefaultModelId,
	deepInfraDefaultModelId,
	minimaxDefaultModelId,
	nanoGptDefaultModelId, //kilocode_change
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { validateApiConfigurationExcludingModelErrors, getModelValidationError } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import { useExtensionState } from "@src/context/ExtensionStateContext"
// kilocode_change start
//import {
//	useOpenRouterModelProviders,
//	OPENROUTER_DEFAULT_PROVIDER_NAME,
//} from "@src/components/ui/hooks/useOpenRouterModelProviders"
// kilocode_change start
import { filterModels } from "./utils/organizationFilters"
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
	SearchableSelect,
	Collapsible,
	CollapsibleTrigger,
	CollapsibleContent,
} from "@src/components/ui"

import {
	Anthropic,
	Apertis, // kilocode_change
	Baseten,
	Corethink,
	Bedrock,
	Cerebras,
	Chutes,
	ClaudeCode,
	DeepSeek,
	Doubao,
	Gemini,
	Glama, // kilocode_change
	Groq,
	HuggingFace,
	IOIntelligence,
	LMStudio,
	LiteLLM,
	Mistral,
	Moonshot,
	NanoGpt, // kilocode_change
	Ollama,
	OpenAI,
	OpenAICompatible,
	OpenAICodex,
	OpenRouter,
	ZenMux, // kilocode_change
	QwenCode,
	Requesty,
	Roo,
	SambaNova,
	Unbound,
	Vertex,
	VSCodeLM,
	XAI,
	// kilocode_change start
	VirtualQuotaFallbackProvider,
	Synthetic,
	OvhCloudAiEndpoints,
	Inception,
	SapAiCore,
	// kilocode_change end
	ZAi,
	Fireworks,
	Featherless,
	VercelAiGateway,
	DeepInfra,
	MiniMax,
} from "./providers"

import { MODELS_BY_PROVIDER, PROVIDERS } from "./constants"
import { inputEventTransform, noTransform } from "./transforms"
// import { ModelPicker } from "./ModelPicker" // kilocode_change
import { ModelInfoView } from "./ModelInfoView"
import { ApiErrorMessage } from "./ApiErrorMessage"
import { ThinkingBudget } from "./ThinkingBudget"
import { Verbosity } from "./Verbosity"
import { DiffSettingsControl } from "./DiffSettingsControl"
import { TodoListSettingsControl } from "./TodoListSettingsControl"
import { TemperatureControl } from "./TemperatureControl"
import { RateLimitSecondsControl } from "./RateLimitSecondsControl"
import { ConsecutiveMistakeLimitControl } from "./ConsecutiveMistakeLimitControl"
import { BedrockCustomArn } from "./providers/BedrockCustomArn"
import { KiloCode } from "../kilocode/settings/providers/KiloCode" // kilocode_change
import { RooBalanceDisplay } from "./providers/RooBalanceDisplay"
import { buildDocLink } from "@src/utils/docLinks"
import { KiloProviderRouting, KiloProviderRoutingManagedByOrganization } from "./providers/KiloProviderRouting"
import { RateLimitAfterControl } from "./RateLimitAfterSettings" // kilocode_change
import { BookOpenText } from "lucide-react"

export interface ApiOptionsProps {
	uriScheme: string | undefined
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	fromWelcomeView?: boolean
	errorMessage: string | undefined
	setErrorMessage: React.Dispatch<React.SetStateAction<string | undefined>>
	hideKiloCodeButton?: boolean // kilocode_change
	currentApiConfigName?: string // kilocode_change
}

const ApiOptions = ({
	uriScheme,
	apiConfiguration,
	setApiConfigurationField,
	fromWelcomeView,
	errorMessage,
	setErrorMessage,
	hideKiloCodeButton = false,
	currentApiConfigName, // kilocode_change
}: ApiOptionsProps) => {
	const { t } = useAppTranslation()
	const {
		organizationAllowList,
		kilocodeDefaultModel,
		cloudIsAuthenticated,
		claudeCodeIsAuthenticated,
		openAiCodexIsAuthenticated,
	} = useExtensionState()

	const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() => {
		const headers = apiConfiguration?.openAiHeaders || {}
		return Object.entries(headers)
	})

	useEffect(() => {
		const propHeaders = apiConfiguration?.openAiHeaders || {}

		if (JSON.stringify(customHeaders) !== JSON.stringify(Object.entries(propHeaders))) {
			setCustomHeaders(Object.entries(propHeaders))
		}
	}, [apiConfiguration?.openAiHeaders, customHeaders])

	// Helper to convert array of tuples to object (filtering out empty keys).

	// Debounced effect to update the main configuration when local
	// customHeaders state stabilizes.
	useDebounce(
		() => {
			const currentConfigHeaders = apiConfiguration?.openAiHeaders || {}
			const newHeadersObject = convertHeadersToObject(customHeaders)

			// Only update if the processed object is different from the current config.
			if (JSON.stringify(currentConfigHeaders) !== JSON.stringify(newHeadersObject)) {
				setApiConfigurationField("openAiHeaders", newHeadersObject)
			}
		},
		300,
		[customHeaders, apiConfiguration?.openAiHeaders, setApiConfigurationField],
	)

	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const {
		provider: selectedProvider,
		id: selectedModelId,
		info: selectedModelInfo,
	} = useSelectedModel(apiConfiguration)

	// kilocode_change start: queryKey, chutesApiKey, gemini
	const { data: routerModels, refetch: refetchRouterModels } = useRouterModels({
		openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
		openRouterApiKey: apiConfiguration?.openRouterApiKey,
		kilocodeOrganizationId: apiConfiguration?.kilocodeOrganizationId ?? "personal",
		deepInfraApiKey: apiConfiguration?.deepInfraApiKey,
		geminiApiKey: apiConfiguration?.geminiApiKey,
		googleGeminiBaseUrl: apiConfiguration?.googleGeminiBaseUrl,
		chutesApiKey: apiConfiguration?.chutesApiKey,
		syntheticApiKey: apiConfiguration?.syntheticApiKey,
		zenmuxBaseUrl: apiConfiguration?.zenmuxBaseUrl,
		zenmuxApiKey: apiConfiguration?.zenmuxApiKey,
	})

	//const { data: openRouterModelProviders } = useOpenRouterModelProviders(
	//	apiConfiguration?.openRouterModelId,
	//	apiConfiguration?.openRouterBaseUrl,
	//	apiConfiguration?.openRouterApiKey,
	//	{
	//		enabled:
	//			!!apiConfiguration?.openRouterModelId &&
	//			routerModels?.openrouter &&
	//			Object.keys(routerModels.openrouter).length > 1 &&
	//			apiConfiguration.openRouterModelId in routerModels.openrouter,
	//	},
	//)
	// kilocode_change end

	// Update `apiModelId` whenever `selectedModelId` changes.
	useEffect(() => {
		if (selectedModelId && apiConfiguration.apiModelId !== selectedModelId) {
			// Pass false as third parameter to indicate this is not a user action
			// This is an internal sync, not a user-initiated change
			setApiConfigurationField("apiModelId", selectedModelId, false)
		}
	}, [selectedModelId, setApiConfigurationField, apiConfiguration.apiModelId])

	// Debounced refresh model updates, only executed 250ms after the user
	// stops typing.
	useDebounce(
		() => {
			if (
				selectedProvider === "openai" ||
				selectedProvider === "openai-responses" // kilocode_change
			) {
				// Use our custom headers state to build the headers object.
				const headerObject = convertHeadersToObject(customHeaders)

				vscode.postMessage({
					type: "requestOpenAiModels",
					values: {
						baseUrl: apiConfiguration?.openAiBaseUrl,
						apiKey: apiConfiguration?.openAiApiKey,
						customHeaders: {}, // Reserved for any additional headers.
						openAiHeaders: headerObject,
					},
				})
			} else if (selectedProvider === "ollama") {
				vscode.postMessage({ type: "requestOllamaModels" })
			} else if (selectedProvider === "lmstudio") {
				vscode.postMessage({ type: "requestLmStudioModels" })
			} else if (selectedProvider === "vscode-lm") {
				vscode.postMessage({ type: "requestVsCodeLmModels" })
			} else if (
				selectedProvider === "litellm" ||
				selectedProvider === "deepinfra" ||
				selectedProvider === "chutes" || // kilocode_change
				selectedProvider === "synthetic" || // kilocode_change
				selectedProvider === "roo"
			) {
				vscode.postMessage({ type: "requestRouterModels" })
			}
		},
		250,
		[
			selectedProvider,
			apiConfiguration?.requestyApiKey,
			apiConfiguration?.openAiBaseUrl,
			apiConfiguration?.openAiApiKey,
			apiConfiguration?.ollamaBaseUrl,
			apiConfiguration?.lmStudioBaseUrl,
			apiConfiguration?.litellmBaseUrl,
			apiConfiguration?.litellmApiKey,
			apiConfiguration?.deepInfraApiKey,
			apiConfiguration?.deepInfraBaseUrl,
			apiConfiguration?.chutesApiKey, // kilocode_change
			apiConfiguration?.ovhCloudAiEndpointsBaseUrl, // kilocode_change
			customHeaders,
		],
	)

	useEffect(() => {
		const apiValidationResult = validateApiConfigurationExcludingModelErrors(
			apiConfiguration,
			routerModels,
			organizationAllowList,
		)
		setErrorMessage(apiValidationResult)
	}, [apiConfiguration, routerModels, organizationAllowList, setErrorMessage])

	const selectedProviderModels = useMemo(() => {
		const models = MODELS_BY_PROVIDER[selectedProvider]

		if (!models) return []

		const filteredModels = filterModels(models, selectedProvider, organizationAllowList)
		// kilocode_change start
		const modelsAllowedByEndpoint =
			selectedProvider === "moonshot" && filteredModels
				? Object.fromEntries(
						Object.entries(filteredModels).filter(
							([modelId]) =>
								apiConfiguration.moonshotBaseUrl === "https://api.kimi.com/coding/v1"
									? modelId === "kimi-for-coding"
									: modelId !== "kimi-for-coding",
						),
					)
				: filteredModels
		// kilocode_change end

		// Include the currently selected model even if deprecated (so users can see what they have selected)
		// But filter out other deprecated models from being newly selectable
		const availableModels = modelsAllowedByEndpoint
			? Object.entries(modelsAllowedByEndpoint)
					.filter(([modelId, modelInfo]) => {
						// Always include the currently selected model
						if (modelId === selectedModelId) return true
						// Filter out deprecated models that aren't currently selected
						return !modelInfo.deprecated
					})
					.map(([modelId]) => ({
						value: modelId,
						label: modelId,
					}))
			: []

		return availableModels
	}, [selectedProvider, organizationAllowList, selectedModelId, apiConfiguration.moonshotBaseUrl])

	const onProviderChange = useCallback(
		(value: ProviderName) => {
			setApiConfigurationField("apiProvider", value)

			// It would be much easier to have a single attribute that stores
			// the modelId, but we have a separate attribute for each of
			// OpenRouter, Glama, Unbound, and Requesty.
			// If you switch to one of these providers and the corresponding
			// modelId is not set then you immediately end up in an error state.
			// To address that we set the modelId to the default value for th
			// provider if it's not already set.
			const validateAndResetModel = (
				provider: ProviderName,
				modelId: string | undefined,
				field: keyof ProviderSettings,
				defaultValue?: string,
			) => {
				// in case we haven't set a default value for a provider
				if (!defaultValue) return

				// 1) If nothing is set, initialize to the provider default.
				if (!modelId) {
					setApiConfigurationField(field, defaultValue, false)
					return
				}

				// 2) If something *is* set, ensure it's valid for the newly selected provider.
				//
				// Without this, switching providers can leave the UI showing a model from the
				// previously selected provider (including model IDs that don't exist for the
				// newly selected provider).
				//
				// Note: We only validate providers with static model lists.
				const staticModels = MODELS_BY_PROVIDER[provider]
				if (!staticModels) {
					return
				}

				// Bedrock has a special “custom-arn” pseudo-model that isn't part of MODELS_BY_PROVIDER.
				if (provider === "bedrock" && modelId === "custom-arn") {
					return
				}

				const filteredModels = filterModels(staticModels, provider, organizationAllowList)
				const isValidModel = !!filteredModels && Object.prototype.hasOwnProperty.call(filteredModels, modelId)
				if (!isValidModel) {
					setApiConfigurationField(field, defaultValue, false)
				}
			}

			// Define a mapping object that associates each provider with its model configuration
			const PROVIDER_MODEL_CONFIG: Partial<
				Record<
					ProviderName,
					{
						field: keyof ProviderSettings
						default?: string
					}
				>
			> = {
				deepinfra: { field: "deepInfraModelId", default: deepInfraDefaultModelId },
				openrouter: { field: "openRouterModelId", default: openRouterDefaultModelId },
				zenmux: { field: "zenmuxModelId", default: zenmuxDefaultModelId },
				glama: { field: "glamaModelId", default: glamaDefaultModelId }, // kilocode_change
				unbound: { field: "unboundModelId", default: unboundDefaultModelId },
				requesty: { field: "requestyModelId", default: requestyDefaultModelId },
				litellm: { field: "litellmModelId", default: litellmDefaultModelId },
				"nano-gpt": { field: "nanoGptModelId", default: nanoGptDefaultModelId }, // kilocode_change
				anthropic: { field: "apiModelId", default: anthropicDefaultModelId },
				cerebras: { field: "apiModelId", default: cerebrasDefaultModelId },
				"claude-code": { field: "apiModelId", default: claudeCodeDefaultModelId },
				"openai-codex": { field: "apiModelId", default: openAiCodexDefaultModelId },
				"qwen-code": { field: "apiModelId", default: qwenCodeDefaultModelId },
				"openai-native": { field: "apiModelId", default: openAiNativeDefaultModelId },
				gemini: { field: "apiModelId", default: geminiDefaultModelId },
				deepseek: { field: "apiModelId", default: deepSeekDefaultModelId },
				doubao: { field: "apiModelId", default: doubaoDefaultModelId },
				moonshot: { field: "apiModelId", default: moonshotDefaultModelId },
				minimax: { field: "apiModelId", default: minimaxDefaultModelId },
				mistral: { field: "apiModelId", default: mistralDefaultModelId },
				xai: { field: "apiModelId", default: xaiDefaultModelId },
				groq: { field: "apiModelId", default: groqDefaultModelId },
				chutes: { field: "apiModelId", default: chutesDefaultModelId },
				baseten: { field: "apiModelId", default: basetenDefaultModelId },
				corethink: { field: "apiModelId", default: corethinkDefaultModelId },
				bedrock: { field: "apiModelId", default: bedrockDefaultModelId },
				vertex: { field: "apiModelId", default: vertexDefaultModelId },
				sambanova: { field: "apiModelId", default: sambaNovaDefaultModelId },
				zai: {
					field: "apiModelId",
					default:
						// kilocode_change - china_api uses mainland model catalog too.
						apiConfiguration.zaiApiLine === "china_coding" || apiConfiguration.zaiApiLine === "china_api"
							? mainlandZAiDefaultModelId
							: internationalZAiDefaultModelId,
				},
				fireworks: { field: "apiModelId", default: fireworksDefaultModelId },
				featherless: { field: "apiModelId", default: featherlessDefaultModelId },
				"io-intelligence": { field: "ioIntelligenceModelId", default: ioIntelligenceDefaultModelId },
				roo: { field: "apiModelId", default: rooDefaultModelId },
				"vercel-ai-gateway": { field: "vercelAiGatewayModelId", default: vercelAiGatewayDefaultModelId },
				openai: { field: "openAiModelId" },
				ollama: { field: "ollamaModelId" },
				lmstudio: { field: "lmStudioModelId" },
				// kilocode_change start
				apertis: { field: "apertisModelId", default: apertisDefaultModelId },
				kilocode: { field: "kilocodeModel", default: kilocodeDefaultModel },
				synthetic: { field: "apiModelId", default: syntheticDefaultModelId },
				ovhcloud: { field: "ovhCloudAiEndpointsModelId", default: ovhCloudAiEndpointsDefaultModelId },
				inception: { field: "inceptionLabsModelId", default: inceptionDefaultModelId },
				// kilocode_change end
			}

			const config = PROVIDER_MODEL_CONFIG[value]
			if (config) {
				validateAndResetModel(
					value,
					apiConfiguration[config.field] as string | undefined,
					config.field,
					config.default,
				)
			}
		},
		[setApiConfigurationField, apiConfiguration, organizationAllowList, kilocodeDefaultModel],
	)

	const modelValidationError = useMemo(() => {
		return getModelValidationError(apiConfiguration, routerModels, organizationAllowList)
	}, [apiConfiguration, routerModels, organizationAllowList])

	const docs = useMemo(() => {
		const provider = PROVIDERS.find(({ value }) => value === selectedProvider)
		const name = provider?.label

		if (!name) {
			return undefined
		}

		// kilocode_change start
		// Providers that don't have documentation pages yet
		const excludedProviders = ["moonshot", "chutes", "cerebras", "litellm", "zai", "qwen-code", "minimax"]

		// Skip documentation link when the provider is excluded because documentation is not available
		if (excludedProviders.includes(selectedProvider)) {
			return undefined
		}
		// kilocode_change end

		// Get the URL slug - use custom mapping if available, otherwise use the provider key.
		const slugs: Record<string, string> = {
			"openai-native": "openai",
			openai: "openai-compatible",
			"openai-responses": "openai-compatible", // kilocode_change
		}

		const slug = slugs[selectedProvider] || selectedProvider
		return {
			url: buildDocLink(`providers/${slug}`, "provider_docs"),
			name,
		}
	}, [selectedProvider])

	// Convert providers to SearchableSelect options
	// kilocode_change start: no organizationAllowList
	const providerOptions = useMemo(
		() =>
			PROVIDERS.map(({ value, label }) => {
				return { value, label }
			}),
		[],
	)
	// kilocode_change end

	return (
		<div className="flex flex-col gap-3">
			{/* kilocode_change start - autocomplete profile type system */}
			{/* Profile Type Display (read-only for existing profiles) */}
			{MODEL_SELECTION_ENABLED && (
				<div className="flex flex-col gap-1">
					<label className="block font-medium mb-1">{t("settings:providers.profileType")}</label>
					<div className="px-3 py-2 bg-vscode-input-background border border-vscode-input-border rounded text-vscode-input-foreground">
						{apiConfiguration.profileType === "autocomplete"
							? t("settings:providers.profileTypeAutocomplete")
							: t("settings:providers.profileTypeChat")}
						{apiConfiguration.profileType === "autocomplete" && (
							<span className="ml-2 text-vscode-descriptionForeground">
								{t("settings:providers.autocompleteLabel")}
							</span>
						)}
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:providers.profileTypeDescription")}
					</div>
				</div>
			)}
			{/* kilocode_change end */}

			<div className="flex flex-col gap-1 relative">
				<div className="flex justify-between items-center">
					<label className="block font-medium">{t("settings:providers.apiProvider")}</label>
					{selectedProvider === "roo" && cloudIsAuthenticated ? (
						<RooBalanceDisplay />
					) : (
						docs && (
							<VSCodeLink href={docs.url} target="_blank" className="flex gap-2">
								{t("settings:providers.apiProviderDocs")}
								<BookOpenText className="size-4 inline ml-2" />
							</VSCodeLink>
						)
					)}
				</div>
				<SearchableSelect
					value={selectedProvider}
					onValueChange={(value) => onProviderChange(value as ProviderName)}
					options={providerOptions}
					placeholder={t("settings:common.select")}
					searchPlaceholder={t("settings:providers.searchProviderPlaceholder")}
					emptyMessage={t("settings:providers.noProviderMatchFound")}
					className="w-full"
					data-testid="provider-select"
				/>
			</div>

			{errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}

			{/* kilocode_change start */}
			{selectedProvider === "kilocode" && (
				<KiloCode
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					hideKiloCodeButton={hideKiloCodeButton}
					currentApiConfigName={currentApiConfigName}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					kilocodeDefaultModel={kilocodeDefaultModel}
				/>
			)}
			{/* kilocode_change end */}

			{selectedProvider === "openrouter" && (
				<OpenRouter
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					selectedModelId={selectedModelId}
					uriScheme={uriScheme}
					simplifySettings={fromWelcomeView}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{/* kilocode_change start */}
			{selectedProvider === "zenmux" && (
				<ZenMux
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					selectedModelId={selectedModelId}
					uriScheme={uriScheme}
					simplifySettings={fromWelcomeView}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}
			{/* kilocode_change end */}

			{selectedProvider === "requesty" && (
				<Requesty
					uriScheme={uriScheme}
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					refetchRouterModels={refetchRouterModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{
				/* kilocode_change start */
				selectedProvider === "glama" && (
					<Glama
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={setApiConfigurationField}
						routerModels={routerModels}
						uriScheme={uriScheme}
						organizationAllowList={organizationAllowList}
						modelValidationError={modelValidationError}
						simplifySettings={fromWelcomeView}
					/>
				)
				/* kilocode_change end */
			}

			{selectedProvider === "unbound" && (
				<Unbound
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "deepinfra" && (
				<DeepInfra
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					refetchRouterModels={refetchRouterModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{/* kilocode_change start */}
			{selectedProvider === "inception" && (
				<Inception
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					refetchRouterModels={refetchRouterModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}
			{/* kilocode_change end */}

			{selectedProvider === "anthropic" && (
				<Anthropic
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{/* kilocode_change start */}
			{selectedProvider === "apertis" && (
				<Apertis apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}
			{/* kilocode_change end */}

			{selectedProvider === "claude-code" && (
				<ClaudeCode
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
					claudeCodeIsAuthenticated={claudeCodeIsAuthenticated}
				/>
			)}

			{selectedProvider === "openai-codex" && (
				<OpenAICodex
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
					openAiCodexIsAuthenticated={openAiCodexIsAuthenticated}
				/>
			)}

			{selectedProvider === "openai-native" && (
				<OpenAI
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					selectedModelInfo={selectedModelInfo}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{/* kilocode_change start */}
			{selectedProvider === "ovhcloud" && (
				<OvhCloudAiEndpoints
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}
			{/* kilocode_change end */}

			{selectedProvider === "mistral" && (
				<Mistral
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "baseten" && (
				<Baseten
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "corethink" && (
				<Corethink
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "bedrock" && (
				<Bedrock
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					selectedModelInfo={selectedModelInfo}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "vertex" && (
				<Vertex
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "gemini" && (
				// kilocode_change: added props
				<Gemini
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					fromWelcomeView={fromWelcomeView}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}

			{(selectedProvider === "openai" || selectedProvider === "openai-responses") /* kilocode_change */ && (
				<OpenAICompatible
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "lmstudio" && (
				<LMStudio
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "deepseek" && (
				<DeepSeek
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "doubao" && (
				<Doubao
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "qwen-code" && (
				<QwenCode
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "moonshot" && (
				<Moonshot
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "minimax" && (
				<MiniMax apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{/* kilocode_change start */}
			{selectedProvider === "nano-gpt" && (
				<NanoGpt
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
				/>
			)}
			{/* kilocode_change end */}

			{selectedProvider === "vscode-lm" && (
				<VSCodeLM apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "ollama" && (
				<Ollama apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "xai" && (
				<XAI apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "groq" && (
				<Groq apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "huggingface" && (
				<HuggingFace apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "cerebras" && (
				<Cerebras apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "chutes" && (
				<Chutes
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{/* kilocode_change start */}
			{selectedProvider === "virtual-quota-fallback" && (
				<VirtualQuotaFallbackProvider
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
				/>
			)}
			{/* kilocode_change end */}

			{selectedProvider === "litellm" && (
				<LiteLLM
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "sambanova" && (
				<SambaNova apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "zai" && (
				<ZAi apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{selectedProvider === "io-intelligence" && (
				<IOIntelligence
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "vercel-ai-gateway" && (
				<VercelAiGateway
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "human-relay" && (
				<>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.humanRelay.description")}
					</div>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.humanRelay.instructions")}
					</div>
				</>
			)}

			{selectedProvider === "fireworks" && (
				<Fireworks apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{
				selectedProvider === "synthetic" && (
					<Synthetic
						apiConfiguration={apiConfiguration}
						setApiConfigurationField={setApiConfigurationField}
						routerModels={routerModels}
						organizationAllowList={organizationAllowList}
						modelValidationError={modelValidationError}
					/>
				)
				// kilocode_change end
			}

			{selectedProvider === "roo" && (
				<Roo
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					routerModels={routerModels}
					cloudIsAuthenticated={cloudIsAuthenticated}
					organizationAllowList={organizationAllowList}
					modelValidationError={modelValidationError}
					simplifySettings={fromWelcomeView}
				/>
			)}

			{selectedProvider === "featherless" && (
				<Featherless apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}

			{/* kilocode_change start */}
			{selectedProvider === "sap-ai-core" && (
				<SapAiCore apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
			)}
			{/* kilocode_change end */}

			{/* Skip generic model picker for claude-code/openai-codex since they have their own model pickers */}
			{selectedProviderModels.length > 0 &&
				selectedProvider !== "claude-code" &&
				selectedProvider !== "openai-codex" && (
					<>
						<div>
							<label className="block font-medium mb-1">{t("settings:providers.model")}</label>
							<Select
								value={selectedModelId === "custom-arn" ? "custom-arn" : selectedModelId}
								onValueChange={(value) => {
									setApiConfigurationField("apiModelId", value)

									// Clear custom ARN if not using custom ARN option.
									if (value !== "custom-arn" && selectedProvider === "bedrock") {
										setApiConfigurationField("awsCustomArn", "")
									}

									// Clear reasoning effort when switching models to allow the new model's default to take effect
									// This is especially important for GPT-5 models which default to "medium"
									if (selectedProvider === "openai-native") {
										setApiConfigurationField("reasoningEffort", undefined)
									}
								}}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									{selectedProviderModels.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
									{selectedProvider === "bedrock" && (
										<SelectItem value="custom-arn">{t("settings:labels.useCustomArn")}</SelectItem>
									)}
								</SelectContent>
							</Select>
						</div>

						{/* Show error if a deprecated model is selected */}
						{selectedModelInfo?.deprecated && (
							<ApiErrorMessage errorMessage={t("settings:validation.modelDeprecated")} />
						)}

						{selectedProvider === "bedrock" && selectedModelId === "custom-arn" && (
							<BedrockCustomArn
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
							/>
						)}

						{/* Only show model info if not deprecated */}
						{!selectedModelInfo?.deprecated && (
							<ModelInfoView
								apiProvider={selectedProvider}
								selectedModelId={selectedModelId}
								modelInfo={selectedModelInfo}
								isDescriptionExpanded={isDescriptionExpanded}
								setIsDescriptionExpanded={setIsDescriptionExpanded}
							/>
						)}
					</>
				)}

			{!fromWelcomeView && (
				<ThinkingBudget
					key={`${selectedProvider}-${selectedModelId}`}
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					modelInfo={selectedModelInfo}
				/>
			)}

			{/* Gate Verbosity UI by capability flag */}
			{!fromWelcomeView && selectedModelInfo?.supportsVerbosity && (
				<Verbosity
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					modelInfo={selectedModelInfo}
				/>
			)}

			{
				// kilocode_change start
				(selectedProvider === "kilocode" || selectedProvider === "openrouter") &&
					(apiConfiguration.kilocodeOrganizationId ? (
						<KiloProviderRoutingManagedByOrganization
							organizationId={apiConfiguration.kilocodeOrganizationId}
						/>
					) : (
						<KiloProviderRouting
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							kilocodeDefaultModel={kilocodeDefaultModel}
						/>
					))
				// kilocode_change end
			}

			{!fromWelcomeView && selectedProvider !== "virtual-quota-fallback" /*kilocode_change*/ && (
				<Collapsible open={isAdvancedSettingsOpen} onOpenChange={setIsAdvancedSettingsOpen}>
					<CollapsibleTrigger className="flex items-center gap-1 w-full cursor-pointer hover:opacity-80 mb-2">
						<span className={`codicon codicon-chevron-${isAdvancedSettingsOpen ? "down" : "right"}`}></span>
						<span className="font-medium">{t("settings:advancedSettings.title")}</span>
					</CollapsibleTrigger>
					<CollapsibleContent className="space-y-3">
						<TodoListSettingsControl
							todoListEnabled={apiConfiguration.todoListEnabled}
							onChange={(field, value) => setApiConfigurationField(field, value)}
						/>
						<DiffSettingsControl
							diffEnabled={apiConfiguration.diffEnabled}
							fuzzyMatchThreshold={apiConfiguration.fuzzyMatchThreshold}
							onChange={(field, value) => setApiConfigurationField(field, value)}
						/>
						{selectedModelInfo?.supportsTemperature !== false && (
							<TemperatureControl
								value={apiConfiguration.modelTemperature}
								onChange={handleInputChange("modelTemperature", noTransform)}
								maxValue={2}
								defaultValue={selectedModelInfo?.defaultTemperature}
							/>
						)}
						{
							// kilocode_change start
							<RateLimitAfterControl
								rateLimitAfterEnabled={apiConfiguration.rateLimitAfter}
								onChange={(field, value) => setApiConfigurationField(field, value)}
							/>
							// kilocode_change end
						}
						<RateLimitSecondsControl
							value={apiConfiguration.rateLimitSeconds || 0}
							onChange={(value) => setApiConfigurationField("rateLimitSeconds", value)}
						/>
						<ConsecutiveMistakeLimitControl
							value={
								apiConfiguration.consecutiveMistakeLimit !== undefined
									? apiConfiguration.consecutiveMistakeLimit
									: DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
							}
							onChange={(value) => setApiConfigurationField("consecutiveMistakeLimit", value)}
						/>
						{/* kilocode_change start
						selectedProvider === "openrouter" &&
							openRouterModelProviders &&
							Object.keys(openRouterModelProviders).length > 0 && (
								<div>
									<div className="flex items-center gap-1">
										<label className="block font-medium mb-1">
											{t("settings:providers.openRouter.providerRouting.title")}
										</label>
										<a href={`https://openrouter.ai/${selectedModelId}/providers`}>
											<ExternalLinkIcon className="w-4 h-4" />
										</a>
									</div>
									<Select
										value={
											apiConfiguration?.openRouterSpecificProvider ||
											OPENROUTER_DEFAULT_PROVIDER_NAME
										}
										onValueChange={(value) =>
											setApiConfigurationField("openRouterSpecificProvider", value)
										}>
										<SelectTrigger className="w-full">
											<SelectValue placeholder={t("settings:common.select")} />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
												{OPENROUTER_DEFAULT_PROVIDER_NAME}
											</SelectItem>
											{Object.entries(openRouterModelProviders).map(([value, { label }]) => (
												<SelectItem key={value} value={value}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<div className="text-sm text-vscode-descriptionForeground mt-1">
										{t("settings:providers.openRouter.providerRouting.description")}{" "}
										<a href="https://openrouter.ai/docs/features/provider-routing">
											{t("settings:providers.openRouter.providerRouting.learnMore")}.
										</a>
									</div>
								</div>
							)
							kilocode_change end */}
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	)
}

export default memo(ApiOptions)
