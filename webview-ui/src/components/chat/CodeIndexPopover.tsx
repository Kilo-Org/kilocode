import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Trans } from "react-i18next"
import { z } from "zod"
import {
	VSCodeButton,
	VSCodeTextField,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeLink,
	VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { AlertTriangle } from "lucide-react"

import { type IndexingStatus, type EmbedderProvider, CODEBASE_INDEX_DEFAULTS } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { buildDocLink } from "@src/utils/docLinks"
import { cn } from "@src/lib/utils"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	Popover,
	PopoverContent,
	Slider,
	StandardTooltip,
	Button,
} from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
// kilocode_change start
import { EmbeddingBatchSizeSlider } from "./kilocode/EmbeddingBatchSizeSlider"
import { MaxBatchRetriesSlider } from "./kilocode/MaxBatchRetriesSlider"
// kilocode_change end
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"

// Default URLs for providers
const DEFAULT_QDRANT_URL = "http://localhost:6333"
const DEFAULT_OLLAMA_URL = "http://localhost:11434"

interface CodeIndexPopoverProps {
	children: React.ReactNode
	// kilocode_change start - Support showing contentOnly and allow external open state control
	contentOnly?: boolean
	open?: boolean
	onOpenChange?: (open: boolean) => void
	onRegisterCloseHandler?: (handler: () => void) => void
	// kilocode_change end - Support showing contentOnly and allow external open state control
	indexingStatus: IndexingStatus
}

interface LocalCodeIndexSettings {
	// Global state settings
	codebaseIndexEnabled: boolean
	codebaseIndexQdrantUrl: string
	codebaseIndexEmbedderProvider: EmbedderProvider
	// kilocode_change - start
	codebaseIndexVectorStoreProvider: "lancedb" | "qdrant"
	codebaseIndexLancedbVectorStoreDirectory?: string
	// kilocode_change - end
	codebaseIndexEmbedderBaseUrl?: string
	codebaseIndexEmbedderModelId: string
	codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
	codebaseIndexSearchMaxResults?: number
	codebaseIndexSearchMinScore?: number
	codebaseIndexEmbeddingBatchSize?: number
	codebaseIndexScannerMaxBatchRetries?: number

	// Bedrock-specific settings
	codebaseIndexBedrockRegion?: string
	codebaseIndexBedrockProfile?: string

	// Secret settings (start empty, will be loaded separately)
	codeIndexOpenAiKey?: string
	codeIndexQdrantApiKey?: string
	codebaseIndexOpenAiCompatibleBaseUrl?: string
	codebaseIndexOpenAiCompatibleApiKey?: string
	codebaseIndexGeminiApiKey?: string
	codebaseIndexMistralApiKey?: string
	codebaseIndexVercelAiGatewayApiKey?: string
	codebaseIndexOpenRouterApiKey?: string
	codebaseIndexOpenRouterSpecificProvider?: string
	codebaseIndexVoyageApiKey?: string // kilocode_change
}

// Validation schema for codebase index settings
const createValidationSchema = (provider: EmbedderProvider, t: any) => {
	const baseSchema = z.object({
		codebaseIndexEnabled: z.boolean(),
		codebaseIndexQdrantUrl: z
			.string()
			.min(1, t("settings:codeIndex.validation.qdrantUrlRequired"))
			.url(t("settings:codeIndex.validation.invalidQdrantUrl")),
		codeIndexQdrantApiKey: z.string().optional(),
	})

	switch (provider) {
		case "openai":
			return baseSchema.extend({
				codeIndexOpenAiKey: z.string().min(1, t("settings:codeIndex.validation.openaiApiKeyRequired")),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})

		case "ollama":
			return baseSchema.extend({
				codebaseIndexEmbedderBaseUrl: z
					.string()
					.min(1, t("settings:codeIndex.validation.ollamaBaseUrlRequired"))
					.url(t("settings:codeIndex.validation.invalidOllamaUrl")),
				codebaseIndexEmbedderModelId: z.string().min(1, t("settings:codeIndex.validation.modelIdRequired")),
				codebaseIndexEmbedderModelDimension: z
					.number()
					.min(1, t("settings:codeIndex.validation.modelDimensionRequired"))
					.optional(),
			})

		case "openai-compatible":
			return baseSchema.extend({
				codebaseIndexOpenAiCompatibleBaseUrl: z
					.string()
					.min(1, t("settings:codeIndex.validation.baseUrlRequired"))
					.url(t("settings:codeIndex.validation.invalidBaseUrl")),
				codebaseIndexOpenAiCompatibleApiKey: z
					.string()
					.min(1, t("settings:codeIndex.validation.apiKeyRequired")),
				codebaseIndexEmbedderModelId: z.string().min(1, t("settings:codeIndex.validation.modelIdRequired")),
				codebaseIndexEmbedderModelDimension: z
					.number()
					.min(1, t("settings:codeIndex.validation.modelDimensionRequired")),
			})

		case "gemini":
			return baseSchema.extend({
				codebaseIndexGeminiApiKey: z.string().min(1, t("settings:codeIndex.validation.geminiApiKeyRequired")),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})

		case "mistral":
			return baseSchema.extend({
				codebaseIndexMistralApiKey: z.string().min(1, t("settings:codeIndex.validation.mistralApiKeyRequired")),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})

		case "vercel-ai-gateway":
			return baseSchema.extend({
				codebaseIndexVercelAiGatewayApiKey: z
					.string()
					.min(1, t("settings:codeIndex.validation.vercelAiGatewayApiKeyRequired")),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})

		case "bedrock":
			return baseSchema.extend({
				codebaseIndexBedrockRegion: z.string().min(1, t("settings:codeIndex.validation.bedrockRegionRequired")),
				codebaseIndexBedrockProfile: z.string().optional(),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})

		case "openrouter":
			return baseSchema.extend({
				codebaseIndexOpenRouterApiKey: z
					.string()
					.min(1, t("settings:codeIndex.validation.openRouterApiKeyRequired")),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})

		// kilocode_change start
		case "voyage":
			return baseSchema.extend({
				codebaseIndexVoyageApiKey: z.string().min(1, t("settings:codeIndex.validation.voyageApiKeyRequired")),
				codebaseIndexEmbedderModelId: z
					.string()
					.min(1, t("settings:codeIndex.validation.modelSelectionRequired")),
			})
		// kilocode_change end

		default:
			return baseSchema
	}
}

// kilcode_change start - Allow rendering just the content of CodeIndexPopover
const NoOpWrapper: React.FC<Record<string, any> & { children?: React.ReactNode }> = ({ children }) => <>{children}</>
// kilcode_change end - Allow rendering just the content of CodeIndexPopover

export const CodeIndexPopover: React.FC<CodeIndexPopoverProps> = ({
	children,
	// kilocode_change start - Support contentOnly and external state control
	contentOnly,
	open: externalOpen,
	onOpenChange: externalOnOpenChange,
	onRegisterCloseHandler,
	// kilocode_change end - Support contentOnly and external state control
	indexingStatus: externalIndexingStatus,
}) => {
	const SECRET_PLACEHOLDER = "••••••••••••••••"
	const { t } = useAppTranslation()
	const { codebaseIndexConfig, codebaseIndexModels, cwd, apiConfiguration } = useExtensionState()

	// kilocode_change start - Controlled/uncontrolled pattern for open state
	// const [open, setOpen] = useState(false) // kilocode_change
	const [internalOpen, setInternalOpen] = useState(false)
	const open = externalOpen ?? internalOpen
	// kilocode_change end - Controlled/uncontrolled pattern for open state
	const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)
	const [isSetupSettingsOpen, setIsSetupSettingsOpen] = useState(false)

	const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>(externalIndexingStatus)

	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
	const [saveError, setSaveError] = useState<string | null>(null)

	// Form validation state
	const [formErrors, setFormErrors] = useState<Record<string, string>>({})

	// Discard changes dialog state
	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const confirmDialogHandler = useRef<(() => void) | null>(null)

	// Default settings template
	const getDefaultSettings = (): LocalCodeIndexSettings => ({
		codebaseIndexEnabled: true,
		codebaseIndexQdrantUrl: "",
		codebaseIndexEmbedderProvider: "openai",
		// kilocode_change - start
		codebaseIndexVectorStoreProvider: "qdrant",
		codebaseIndexLancedbVectorStoreDirectory: undefined,
		// kilocode_change - end
		codebaseIndexEmbedderBaseUrl: "",
		codebaseIndexEmbedderModelId: "",
		codebaseIndexEmbedderModelDimension: undefined,
		codebaseIndexSearchMaxResults: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
		codebaseIndexSearchMinScore: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
		codebaseIndexEmbeddingBatchSize: CODEBASE_INDEX_DEFAULTS.DEFAULT_EMBEDDING_BATCH_SIZE,
		codebaseIndexScannerMaxBatchRetries: CODEBASE_INDEX_DEFAULTS.DEFAULT_SCANNER_MAX_BATCH_RETRIES,
		codebaseIndexBedrockRegion: "",
		codebaseIndexBedrockProfile: "",
		codeIndexOpenAiKey: "",
		codeIndexQdrantApiKey: "",
		codebaseIndexOpenAiCompatibleBaseUrl: "",
		codebaseIndexOpenAiCompatibleApiKey: "",
		codebaseIndexGeminiApiKey: "",
		codebaseIndexMistralApiKey: "",
		codebaseIndexVercelAiGatewayApiKey: "",
		codebaseIndexOpenRouterApiKey: "",
		codebaseIndexOpenRouterSpecificProvider: "",
		codebaseIndexVoyageApiKey: "", // kilocode_change
	})

	// Initial settings state - stores the settings when popover opens
	const [initialSettings, setInitialSettings] = useState<LocalCodeIndexSettings>(getDefaultSettings())

	// Current settings state - tracks user changes
	const [currentSettings, setCurrentSettings] = useState<LocalCodeIndexSettings>(getDefaultSettings())

	// Update indexing status from parent
	useEffect(() => {
		setIndexingStatus(externalIndexingStatus)
	}, [externalIndexingStatus])

	// Initialize settings from global state
	useEffect(() => {
		// kilocode_change start
		// Don't update settings if we just saved (prevents race condition with state updates)
		// Skip update if we're currently saving or just saved
		if (saveStatus === "saving" || saveStatus === "saved") {
			return
		}
		// kilocode_change end

		if (codebaseIndexConfig) {
			const settings = {
				codebaseIndexEnabled: codebaseIndexConfig.codebaseIndexEnabled ?? true,
				codebaseIndexQdrantUrl: codebaseIndexConfig.codebaseIndexQdrantUrl || "",
				codebaseIndexEmbedderProvider: codebaseIndexConfig.codebaseIndexEmbedderProvider || "openai",
				// kilocode_change - start
				codebaseIndexVectorStoreProvider: codebaseIndexConfig.codebaseIndexVectorStoreProvider || "qdrant",
				codebaseIndexLancedbVectorStoreDirectory: codebaseIndexConfig.codebaseIndexLancedbVectorStoreDirectory,
				// kilocode_change - end
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig.codebaseIndexEmbedderBaseUrl || "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig.codebaseIndexEmbedderModelId || "",
				codebaseIndexEmbedderModelDimension:
					codebaseIndexConfig.codebaseIndexEmbedderModelDimension || undefined,
				codebaseIndexSearchMaxResults:
					codebaseIndexConfig.codebaseIndexSearchMaxResults ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
				codebaseIndexSearchMinScore:
					codebaseIndexConfig.codebaseIndexSearchMinScore ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
				codebaseIndexEmbeddingBatchSize:
					codebaseIndexConfig.codebaseIndexEmbeddingBatchSize ??
					CODEBASE_INDEX_DEFAULTS.DEFAULT_EMBEDDING_BATCH_SIZE,
				codebaseIndexScannerMaxBatchRetries:
					codebaseIndexConfig.codebaseIndexScannerMaxBatchRetries ??
					CODEBASE_INDEX_DEFAULTS.DEFAULT_SCANNER_MAX_BATCH_RETRIES,
				codebaseIndexBedrockRegion: codebaseIndexConfig.codebaseIndexBedrockRegion || "",
				codebaseIndexBedrockProfile: codebaseIndexConfig.codebaseIndexBedrockProfile || "",
				codeIndexOpenAiKey: "",
				codeIndexQdrantApiKey: "",
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl || "",
				codebaseIndexOpenAiCompatibleApiKey: "",
				codebaseIndexGeminiApiKey: "",
				codebaseIndexMistralApiKey: "",
				codebaseIndexVercelAiGatewayApiKey: "",
				codebaseIndexOpenRouterApiKey: "",
				codebaseIndexOpenRouterSpecificProvider:
					codebaseIndexConfig.codebaseIndexOpenRouterSpecificProvider || "",
				codebaseIndexVoyageApiKey: "", // kilocode_change
			}
			setInitialSettings(settings)
			setCurrentSettings(settings)

			// Request secret status to check if secrets exist
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
	}, [codebaseIndexConfig, saveStatus]) // kilocode_change - Added saveStatus to dependency array

	// Request initial indexing status
	useEffect(() => {
		if (open) {
			vscode.postMessage({ type: "requestIndexingStatus" })
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
		const handleMessage = (event: MessageEvent) => {
			if (event.data.type === "workspaceUpdated") {
				// When workspace changes, request updated indexing status
				if (open) {
					vscode.postMessage({ type: "requestIndexingStatus" })
					vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [open])

	// Use a ref to capture current settings for the save handler
	const currentSettingsRef = useRef(currentSettings)
	currentSettingsRef.current = currentSettings

	// Listen for indexing status updates and save responses
	useEffect(() => {
		const handleMessage = (event: MessageEvent<any>) => {
			if (event.data.type === "indexingStatusUpdate") {
				if (!event.data.values.workspacePath || event.data.values.workspacePath === cwd) {
					setIndexingStatus({
						systemStatus: event.data.values.systemStatus,
						message: event.data.values.message || "",
						processedItems: event.data.values.processedItems,
						totalItems: event.data.values.totalItems,
						currentItemUnit: event.data.values.currentItemUnit || "items",
					})
				}
			} else if (event.data.type === "codeIndexSettingsSaved") {
				if (event.data.success) {
					setSaveStatus("saved")
					// Update initial settings to match current settings after successful save
					// This ensures hasUnsavedChanges becomes false
					const savedSettings = { ...currentSettingsRef.current }
					setInitialSettings(savedSettings)
					// Also update current settings to maintain consistency
					setCurrentSettings(savedSettings)
					// Request secret status to ensure we have the latest state
					// This is important to maintain placeholder display after save

					vscode.postMessage({ type: "requestCodeIndexSecretStatus" })

					setSaveStatus("idle")
				} else {
					setSaveStatus("error")
					setSaveError(event.data.error || t("settings:codeIndex.saveError"))
					// Clear error message after 5 seconds
					setSaveStatus("idle")
					setSaveError(null)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [t, cwd])

	// Listen for secret status
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.data.type === "codeIndexSecretStatus") {
				// Update settings to show placeholders for existing secrets
				const secretStatus = event.data.values

				// Update both current and initial settings based on what secrets exist
				const updateWithSecrets = (prev: LocalCodeIndexSettings): LocalCodeIndexSettings => {
					const updated = { ...prev }

					// Only update to placeholder if the field is currently empty or already a placeholder
					// This preserves user input when they're actively editing
					if (!prev.codeIndexOpenAiKey || prev.codeIndexOpenAiKey === SECRET_PLACEHOLDER) {
						updated.codeIndexOpenAiKey = secretStatus.hasOpenAiKey ? SECRET_PLACEHOLDER : ""
					}
					if (!prev.codeIndexQdrantApiKey || prev.codeIndexQdrantApiKey === SECRET_PLACEHOLDER) {
						updated.codeIndexQdrantApiKey = secretStatus.hasQdrantApiKey ? SECRET_PLACEHOLDER : ""
					}
					if (
						!prev.codebaseIndexOpenAiCompatibleApiKey ||
						prev.codebaseIndexOpenAiCompatibleApiKey === SECRET_PLACEHOLDER
					) {
						updated.codebaseIndexOpenAiCompatibleApiKey = secretStatus.hasOpenAiCompatibleApiKey
							? SECRET_PLACEHOLDER
							: ""
					}
					if (!prev.codebaseIndexGeminiApiKey || prev.codebaseIndexGeminiApiKey === SECRET_PLACEHOLDER) {
						updated.codebaseIndexGeminiApiKey = secretStatus.hasGeminiApiKey ? SECRET_PLACEHOLDER : ""
					}
					if (!prev.codebaseIndexMistralApiKey || prev.codebaseIndexMistralApiKey === SECRET_PLACEHOLDER) {
						updated.codebaseIndexMistralApiKey = secretStatus.hasMistralApiKey ? SECRET_PLACEHOLDER : ""
					}
					if (
						!prev.codebaseIndexVercelAiGatewayApiKey ||
						prev.codebaseIndexVercelAiGatewayApiKey === SECRET_PLACEHOLDER
					) {
						updated.codebaseIndexVercelAiGatewayApiKey = secretStatus.hasVercelAiGatewayApiKey
							? SECRET_PLACEHOLDER
							: ""
					}
					if (
						!prev.codebaseIndexOpenRouterApiKey ||
						prev.codebaseIndexOpenRouterApiKey === SECRET_PLACEHOLDER
					) {
						updated.codebaseIndexOpenRouterApiKey = secretStatus.hasOpenRouterApiKey
							? SECRET_PLACEHOLDER
							: ""
					}
					// kilocode_change start
					if (!prev.codebaseIndexVoyageApiKey || prev.codebaseIndexVoyageApiKey === SECRET_PLACEHOLDER) {
						updated.codebaseIndexVoyageApiKey = secretStatus.hasVoyageApiKey ? SECRET_PLACEHOLDER : ""
					}
					// kilocode_change end

					return updated
				}

				// Only update settings if we're not in the middle of saving
				// After save is complete (saved status), we still want to update to maintain consistency
				if (saveStatus === "idle" || saveStatus === "saved") {
					setCurrentSettings(updateWithSecrets)
					setInitialSettings(updateWithSecrets)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [saveStatus])

	// Generic comparison function that detects changes between initial and current settings
	const hasUnsavedChanges = useMemo(() => {
		// Get all keys from both objects to handle any field
		const allKeys = [...Object.keys(initialSettings), ...Object.keys(currentSettings)] as Array<
			keyof LocalCodeIndexSettings
		>

		// Use a Set to ensure unique keys
		const uniqueKeys = Array.from(new Set(allKeys))

		for (const key of uniqueKeys) {
			const currentValue = currentSettings[key]
			const initialValue = initialSettings[key]

			// For secret fields, check if the value has been modified from placeholder
			if (currentValue === SECRET_PLACEHOLDER) {
				// If it's still showing placeholder, no change
				continue
			}

			// Compare values - handles all types including undefined
			if (currentValue !== initialValue) {
				return true
			}
		}

		return false
	}, [currentSettings, initialSettings])

	const updateSetting = (key: keyof LocalCodeIndexSettings, value: any) => {
		setCurrentSettings((prev) => ({ ...prev, [key]: value }))
		// Clear validation error for this field when user starts typing
		if (formErrors[key]) {
			setFormErrors((prev) => {
				const newErrors = { ...prev }
				delete newErrors[key]
				return newErrors
			})
		}
	}

	// Validation function
	const validateSettings = (): boolean => {
		// kilocode_change start
		// If codebase indexing is disabled, skip validation of configuration fields
		// User should be able to disable the feature without having all fields filled in
		if (!currentSettings.codebaseIndexEnabled) {
			setFormErrors({})
			return true
		}
		// kilocode_change end

		const schema = createValidationSchema(currentSettings.codebaseIndexEmbedderProvider, t)

		// Prepare data for validation
		const dataToValidate: any = {}
		for (const [key, value] of Object.entries(currentSettings)) {
			// For secret fields with placeholder values, treat them as valid (they exist in backend)
			if (value === SECRET_PLACEHOLDER) {
				// Add a dummy value that will pass validation for these fields
				if (
					key === "codeIndexOpenAiKey" ||
					key === "codebaseIndexOpenAiCompatibleApiKey" ||
					key === "codebaseIndexGeminiApiKey" ||
					key === "codebaseIndexMistralApiKey" ||
					key === "codebaseIndexVercelAiGatewayApiKey" ||
					key === "codebaseIndexOpenRouterApiKey" ||
					key === "codebaseIndexVoyageApiKey" // kilocode_change
				) {
					dataToValidate[key] = "placeholder-valid"
				}
			} else {
				dataToValidate[key] = value
			}
		}

		try {
			// Validate using the schema
			schema.parse(dataToValidate)
			setFormErrors({})
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errors: Record<string, string> = {}
				error.errors.forEach((err) => {
					if (err.path[0]) {
						errors[err.path[0] as string] = err.message
					}
				})
				setFormErrors(errors)

				// kilocode_change start
				// Auto-expand Setup section if there are validation errors
				// (so users can see what needs to be configured)
				if (Object.keys(errors).length > 0) {
					setIsSetupSettingsOpen(true)
				}
				// kilocode_change end
			}
			return false
		}
	}

	// Discard changes functionality
	const checkUnsavedChanges = useCallback(
		(then: () => void) => {
			if (hasUnsavedChanges) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[hasUnsavedChanges],
	)

	const onConfirmDialogResult = useCallback(
		(confirm: boolean) => {
			if (confirm) {
				// Discard changes: Reset to initial settings
				setCurrentSettings(initialSettings)
				setFormErrors({}) // Clear any validation errors
				confirmDialogHandler.current?.() // Execute the pending action (e.g., close popover)
			}
			setDiscardDialogShow(false)
		},
		[initialSettings],
	)

	// kilocode_change start - Register close handler for parent popover control
	const handleRequestClose = useCallback(() => {
		// Handler that checks unsaved changes before allowing close
		checkUnsavedChanges(() => {
			if (externalOnOpenChange) {
				externalOnOpenChange(false)
			} else {
				setInternalOpen(false)
			}
		})
	}, [checkUnsavedChanges, externalOnOpenChange])

	useEffect(() => {
		onRegisterCloseHandler?.(handleRequestClose)
	}, [onRegisterCloseHandler, handleRequestClose])

	// For direct onOpenChange calls (non-contentOnly mode), wrap to check unsaved changes
	const wrappedOnOpenChange = useCallback(
		(newOpen: boolean) => {
			if (!newOpen) {
				handleRequestClose()
			} else {
				externalOnOpenChange?.(true)
				setInternalOpen(true)
			}
		},
		[handleRequestClose, externalOnOpenChange],
	)
	const setOpen = externalOnOpenChange ? wrappedOnOpenChange : setInternalOpen
	// kilocode_change end - Register close handler for parent popover control

	// Handle popover close with unsaved changes check
	const handlePopoverClose = useCallback(() => {
		checkUnsavedChanges(() => {
			setOpen(false)
		})
	}, [checkUnsavedChanges, setOpen]) // kilocode_change

	// Use the shared ESC key handler hook - respects unsaved changes logic
	useEscapeKey(open, handlePopoverClose)

	// kilocode_change start
	const handleCancelIndexing = useCallback(() => {
		// Optimistically update UI while backend cancels
		setIndexingStatus((prev) => ({
			...prev,
			message: t("settings:codeIndex.cancelling"),
		}))
		vscode.postMessage({ type: "cancelIndexing" })
	}, [t])
	// kilocode_change end

	const handleSaveSettings = () => {
		// Validate settings before saving
		if (!validateSettings()) {
			return
		}

		setSaveStatus("saving")
		setSaveError(null)

		// Prepare settings to save
		const settingsToSave: any = {}

		// Iterate through all current settings
		for (const [key, value] of Object.entries(currentSettings)) {
			// For secret fields with placeholder, don't send the placeholder
			// but also don't send an empty string - just skip the field
			// This tells the backend to keep the existing secret
			if (value === SECRET_PLACEHOLDER) {
				// Skip sending placeholder values - backend will preserve existing secrets
				continue
			}

			// Include all other fields, including empty strings (which clear secrets)
			settingsToSave[key] = value
		}

		// Always include codebaseIndexEnabled to ensure it's persisted
		settingsToSave.codebaseIndexEnabled = currentSettings.codebaseIndexEnabled

		// Save settings to backend
		vscode.postMessage({
			type: "saveCodeIndexSettingsAtomic",
			codeIndexSettings: settingsToSave,
		})
	}

	const progressPercentage = useMemo(
		() =>
			indexingStatus.totalItems > 0
				? Math.round((indexingStatus.processedItems / indexingStatus.totalItems) * 100)
				: 0,
		[indexingStatus.processedItems, indexingStatus.totalItems],
	)

	const transformStyleString = `translateX(-${100 - progressPercentage}%)`

	const getAvailableModels = () => {
		if (!codebaseIndexModels) return []

		const models =
			codebaseIndexModels[currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels]
		return models ? Object.keys(models) : []
	}

	// Fetch OpenRouter model providers for embedding model
	const { data: openRouterEmbeddingProviders } = useOpenRouterModelProviders(
		currentSettings.codebaseIndexEmbedderProvider === "openrouter"
			? currentSettings.codebaseIndexEmbedderModelId
			: undefined,
		// kilocode_change start
		apiConfiguration?.apiProvider === "openrouter" ? apiConfiguration?.openRouterBaseUrl : undefined,
		apiConfiguration?.apiKey,
		apiConfiguration?.kilocodeOrganizationId ?? "personal",
		// kilocode_change end
		{
			enabled:
				currentSettings.codebaseIndexEmbedderProvider === "openrouter" &&
				!!currentSettings.codebaseIndexEmbedderModelId,
		},
	)

	const portalContainer = useRooPortal("roo-portal")

	// kilcode_change start - Allow rendering just the content of CodeIndexPopover
	const MaybePopover = !contentOnly ? Popover : NoOpWrapper
	const MaybePopoverContent = !contentOnly ? PopoverContent : NoOpWrapper
	// kilcode_change end - Allow rendering just the content of CodeIndexPopover

	return (
		<>
			{/* kilocode_change - Popover -> MaybePopover */}
			<MaybePopover
				open={open}
				onOpenChange={(newOpen) => {
					if (!newOpen) {
						// User is trying to close the popover
						handlePopoverClose()
					} else {
						setOpen(newOpen)
					}
				}}>
				{children}
				{/* kilocode_change - PopoverContent -> MaybePopoverContent */}
				<MaybePopoverContent
					className="w-[calc(100vw-32px)] max-w-[450px] max-h-[80vh] overflow-y-auto p-0"
					align="end"
					alignOffset={0}
					side="bottom"
					sideOffset={5}
					collisionPadding={16}
					avoidCollisions={true}
					container={portalContainer}>
					<div className="p-3 border-b border-vscode-dropdown-border cursor-default">
						<div className="flex flex-row items-center gap-1 p-0 mt-0 mb-1 w-full">
							<h4 className="m-0 pb-2 flex-1">{t("settings:codeIndex.title")}</h4>
						</div>
						<p className="my-0 pr-4 text-sm w-full">
							<Trans i18nKey="settings:codeIndex.description">
								<VSCodeLink
									href={buildDocLink("features/codebase-indexing", "settings")}
									style={{ display: "inline" }}
								/>
							</Trans>
						</p>
					</div>

					<div className="p-4">
						{/* Enable/Disable Toggle */}
						<div className="mb-4">
							<div className="flex items-center gap-2">
								<VSCodeCheckbox
									checked={currentSettings.codebaseIndexEnabled}
									onChange={(e: any) => updateSetting("codebaseIndexEnabled", e.target.checked)}>
									<span className="font-medium">{t("settings:codeIndex.enableLabel")}</span>
								</VSCodeCheckbox>
								<StandardTooltip content={t("settings:codeIndex.enableDescription")}>
									<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
								</StandardTooltip>
							</div>
						</div>

						{/* Status Section */}
						<div className="space-y-2">
							<h4 className="text-sm font-medium">{t("settings:codeIndex.statusTitle")}</h4>
							<div className="text-sm text-vscode-descriptionForeground">
								<span
									className={cn("inline-block w-3 h-3 rounded-full mr-2", {
										"bg-gray-400": indexingStatus.systemStatus === "Standby",
										"bg-yellow-500 animate-pulse": indexingStatus.systemStatus === "Indexing",
										"bg-green-500": indexingStatus.systemStatus === "Indexed",
										"bg-red-500": indexingStatus.systemStatus === "Error",
									})}
								/>
								{t(`settings:codeIndex.indexingStatuses.${indexingStatus.systemStatus.toLowerCase()}`)}
								{indexingStatus.message ? ` - ${indexingStatus.message}` : ""}
							</div>

							{indexingStatus.systemStatus === "Indexing" && (
								<div className="mt-2">
									<ProgressPrimitive.Root
										className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
										value={progressPercentage}>
										<ProgressPrimitive.Indicator
											className="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-in-out"
											style={{
												transform: transformStyleString,
											}}
										/>
									</ProgressPrimitive.Root>
								</div>
							)}
						</div>

						{/* Setup Settings Disclosure */}
						<div className="mt-4">
							<button
								onClick={() => setIsSetupSettingsOpen(!isSetupSettingsOpen)}
								className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus:outline-none"
								aria-expanded={isSetupSettingsOpen}>
								<span
									className={`codicon codicon-${isSetupSettingsOpen ? "chevron-down" : "chevron-right"} mr-1`}></span>
								<span className="text-base font-semibold">
									{t("settings:codeIndex.setupConfigLabel")}
								</span>
							</button>

							{isSetupSettingsOpen && (
								<div className="mt-4 space-y-4">
									{/* Embedder Provider Section */}
									<div className="space-y-2">
										<label className="text-sm font-medium">
											{t("settings:codeIndex.embedderProviderLabel")}
										</label>
										<Select
											value={currentSettings.codebaseIndexEmbedderProvider}
											onValueChange={(value: EmbedderProvider) => {
												updateSetting("codebaseIndexEmbedderProvider", value)
												// Clear model selection when switching providers
												updateSetting("codebaseIndexEmbedderModelId", "")

												// Auto-populate Region and Profile when switching to Bedrock
												// if the main API provider is also configured for Bedrock
												if (
													value === "bedrock" &&
													apiConfiguration?.apiProvider === "bedrock"
												) {
													// Only populate if currently empty
													if (
														!currentSettings.codebaseIndexBedrockRegion &&
														apiConfiguration.awsRegion
													) {
														updateSetting(
															"codebaseIndexBedrockRegion",
															apiConfiguration.awsRegion,
														)
													}
													if (
														!currentSettings.codebaseIndexBedrockProfile &&
														apiConfiguration.awsProfile
													) {
														updateSetting(
															"codebaseIndexBedrockProfile",
															apiConfiguration.awsProfile,
														)
													}
												}
											}}>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="openai">
													{t("settings:codeIndex.openaiProvider")}
												</SelectItem>
												<SelectItem value="ollama">
													{t("settings:codeIndex.ollamaProvider")}
												</SelectItem>
												<SelectItem value="openai-compatible">
													{t("settings:codeIndex.openaiCompatibleProvider")}
												</SelectItem>
												<SelectItem value="gemini">
													{t("settings:codeIndex.geminiProvider")}
												</SelectItem>
												<SelectItem value="mistral">
													{t("settings:codeIndex.mistralProvider")}
												</SelectItem>
												<SelectItem value="vercel-ai-gateway">
													{t("settings:codeIndex.vercelAiGatewayProvider")}
												</SelectItem>
												<SelectItem value="bedrock">
													{t("settings:codeIndex.bedrockProvider")}
												</SelectItem>
												<SelectItem value="openrouter">
													{t("settings:codeIndex.openRouterProvider")}
												</SelectItem>
												{/* kilocode_change start */}
												<SelectItem value="voyage">
													{t("settings:codeIndex.voyageProvider")}
												</SelectItem>
												{/* kilocode_change end */}
											</SelectContent>
										</Select>
									</div>

									{/* Provider-specific settings */}
									{currentSettings.codebaseIndexEmbedderProvider === "openai" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.openAiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codeIndexOpenAiKey || ""}
													onInput={(e: any) =>
														updateSetting("codeIndexOpenAiKey", e.target.value)
													}
													placeholder={t("settings:codeIndex.openAiKeyPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codeIndexOpenAiKey,
													})}
												/>
												{formErrors.codeIndexOpenAiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codeIndexOpenAiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>
										</>
									)}

									{currentSettings.codebaseIndexEmbedderProvider === "ollama" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.ollamaBaseUrlLabel")}
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexEmbedderBaseUrl || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexEmbedderBaseUrl", e.target.value)
													}
													onBlur={(e: any) => {
														// Set default Ollama URL if field is empty
														if (!e.target.value.trim()) {
															e.target.value = DEFAULT_OLLAMA_URL
															updateSetting(
																"codebaseIndexEmbedderBaseUrl",
																DEFAULT_OLLAMA_URL,
															)
														}
													}}
													placeholder={t("settings:codeIndex.ollamaUrlPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderBaseUrl,
													})}
												/>
												{formErrors.codebaseIndexEmbedderBaseUrl && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderBaseUrl}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexEmbedderModelId || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													placeholder={t("settings:codeIndex.modelPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}
												/>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelDimensionLabel")}
												</label>
												<VSCodeTextField
													value={
														currentSettings.codebaseIndexEmbedderModelDimension?.toString() ||
														""
													}
													onInput={(e: any) => {
														const value = e.target.value
															? parseInt(e.target.value, 10) || undefined
															: undefined
														updateSetting("codebaseIndexEmbedderModelDimension", value)
													}}
													placeholder={t("settings:codeIndex.modelDimensionPlaceholder")}
													className={cn("w-full", {
														"border-red-500":
															formErrors.codebaseIndexEmbedderModelDimension,
													})}
												/>
												{formErrors.codebaseIndexEmbedderModelDimension && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelDimension}
													</p>
												)}
											</div>
										</>
									)}

									{currentSettings.codebaseIndexEmbedderProvider === "openai-compatible" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.openAiCompatibleBaseUrlLabel")}
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexOpenAiCompatibleBaseUrl || ""}
													onInput={(e: any) =>
														updateSetting(
															"codebaseIndexOpenAiCompatibleBaseUrl",
															e.target.value,
														)
													}
													placeholder={t(
														"settings:codeIndex.openAiCompatibleBaseUrlPlaceholder",
													)}
													className={cn("w-full", {
														"border-red-500":
															formErrors.codebaseIndexOpenAiCompatibleBaseUrl,
													})}
												/>
												{formErrors.codebaseIndexOpenAiCompatibleBaseUrl && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexOpenAiCompatibleBaseUrl}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.openAiCompatibleApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codebaseIndexOpenAiCompatibleApiKey || ""}
													onInput={(e: any) =>
														updateSetting(
															"codebaseIndexOpenAiCompatibleApiKey",
															e.target.value,
														)
													}
													placeholder={t(
														"settings:codeIndex.openAiCompatibleApiKeyPlaceholder",
													)}
													className={cn("w-full", {
														"border-red-500":
															formErrors.codebaseIndexOpenAiCompatibleApiKey,
													})}
												/>
												{formErrors.codebaseIndexOpenAiCompatibleApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexOpenAiCompatibleApiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexEmbedderModelId || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													placeholder={t("settings:codeIndex.modelPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}
												/>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelDimensionLabel")}
												</label>
												<VSCodeTextField
													value={
														currentSettings.codebaseIndexEmbedderModelDimension?.toString() ||
														""
													}
													onInput={(e: any) => {
														const value = e.target.value
															? parseInt(e.target.value, 10) || undefined
															: undefined
														updateSetting("codebaseIndexEmbedderModelDimension", value)
													}}
													placeholder={t("settings:codeIndex.modelDimensionPlaceholder")}
													className={cn("w-full", {
														"border-red-500":
															formErrors.codebaseIndexEmbedderModelDimension,
													})}
												/>
												{formErrors.codebaseIndexEmbedderModelDimension && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelDimension}
													</p>
												)}
											</div>
										</>
									)}

									{currentSettings.codebaseIndexEmbedderProvider === "gemini" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.geminiApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codebaseIndexGeminiApiKey || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexGeminiApiKey", e.target.value)
													}
													placeholder={t("settings:codeIndex.geminiApiKeyPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexGeminiApiKey,
													})}
												/>
												{formErrors.codebaseIndexGeminiApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexGeminiApiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>
										</>
									)}

									{currentSettings.codebaseIndexEmbedderProvider === "mistral" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.mistralApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codebaseIndexMistralApiKey || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexMistralApiKey", e.target.value)
													}
													placeholder={t("settings:codeIndex.mistralApiKeyPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexMistralApiKey,
													})}
												/>
												{formErrors.codebaseIndexMistralApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexMistralApiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>
										</>
									)}

									{/* vectorStoreProviderLabel */}
									{/* kilocode_change start */}
									<div className="space-y-2">
										<label className="text-sm font-medium">
											{t("settings:codeIndex.vectorStoreProviderLabel")}
										</label>
										<Select
											value={currentSettings.codebaseIndexVectorStoreProvider}
											onValueChange={(value: "lancedb" | "qdrant") => {
												updateSetting("codebaseIndexVectorStoreProvider", value)
											}}>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="qdrant">Qdrant</SelectItem>
												<SelectItem value="lancedb">LanceDB</SelectItem>
											</SelectContent>
										</Select>
									</div>
									{/* kilocode_change end */}

									{currentSettings.codebaseIndexEmbedderProvider === "vercel-ai-gateway" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.vercelAiGatewayApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codebaseIndexVercelAiGatewayApiKey || ""}
													onInput={(e: any) =>
														updateSetting(
															"codebaseIndexVercelAiGatewayApiKey",
															e.target.value,
														)
													}
													placeholder={t(
														"settings:codeIndex.vercelAiGatewayApiKeyPlaceholder",
													)}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexVercelAiGatewayApiKey,
													})}
												/>
												{formErrors.codebaseIndexVercelAiGatewayApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexVercelAiGatewayApiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>
										</>
									)}

									{currentSettings.codebaseIndexEmbedderProvider === "bedrock" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.bedrockRegionLabel")}
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexBedrockRegion || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexBedrockRegion", e.target.value)
													}
													placeholder={t("settings:codeIndex.bedrockRegionPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexBedrockRegion,
													})}
												/>
												{formErrors.codebaseIndexBedrockRegion && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexBedrockRegion}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.bedrockProfileLabel")}
													<span className="text-xs text-vscode-descriptionForeground ml-1">
														({t("settings:codeIndex.optional")})
													</span>
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexBedrockProfile || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexBedrockProfile", e.target.value)
													}
													placeholder={t("settings:codeIndex.bedrockProfilePlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexBedrockProfile,
													})}
												/>
												{formErrors.codebaseIndexBedrockProfile && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexBedrockProfile}
													</p>
												)}
												{!formErrors.codebaseIndexBedrockProfile && (
													<p className="text-xs text-vscode-descriptionForeground mt-1 mb-0">
														{t("settings:codeIndex.bedrockProfileDescription")}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>
										</>
									)}

									{currentSettings.codebaseIndexEmbedderProvider === "openrouter" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.openRouterApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codebaseIndexOpenRouterApiKey || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexOpenRouterApiKey", e.target.value)
													}
													placeholder={t("settings:codeIndex.openRouterApiKeyPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexOpenRouterApiKey,
													})}
												/>
												{formErrors.codebaseIndexOpenRouterApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexOpenRouterApiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>

											{/* Provider Routing for OpenRouter */}
											{openRouterEmbeddingProviders &&
												Object.keys(openRouterEmbeddingProviders).length > 0 && (
													<div className="space-y-2">
														<label className="text-sm font-medium">
															<a
																href="https://openrouter.ai/docs/features/provider-routing"
																target="_blank"
																rel="noopener noreferrer"
																className="flex items-center gap-1 hover:underline">
																{t("settings:codeIndex.openRouterProviderRoutingLabel")}
																<span className="codicon codicon-link-external text-xs" />
															</a>
														</label>
														<Select
															value={
																currentSettings.codebaseIndexOpenRouterSpecificProvider ||
																OPENROUTER_DEFAULT_PROVIDER_NAME
															}
															onValueChange={(value) =>
																updateSetting(
																	"codebaseIndexOpenRouterSpecificProvider",
																	value,
																)
															}>
															<SelectTrigger className="w-full">
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
																	{OPENROUTER_DEFAULT_PROVIDER_NAME}
																</SelectItem>
																{Object.entries(openRouterEmbeddingProviders).map(
																	([value, { label }]) => (
																		<SelectItem key={value} value={value}>
																			{label}
																		</SelectItem>
																	),
																)}
															</SelectContent>
														</Select>
														<p className="text-xs text-vscode-descriptionForeground mt-1 mb-0">
															{t(
																"settings:codeIndex.openRouterProviderRoutingDescription",
															)}
														</p>
													</div>
												)}
										</>
									)}

									{/* kilocode_change start */}
									{/* Voyage AI Settings */}
									{currentSettings.codebaseIndexEmbedderProvider === "voyage" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.voyageApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codebaseIndexVoyageApiKey || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexVoyageApiKey", e.target.value)
													}
													placeholder={t("settings:codeIndex.voyageApiKeyPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexVoyageApiKey,
													})}
												/>
												{formErrors.codebaseIndexVoyageApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexVoyageApiKey}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.modelLabel")}
												</label>
												<VSCodeDropdown
													value={currentSettings.codebaseIndexEmbedderModelId || ""}
													onChange={(e: any) =>
														updateSetting("codebaseIndexEmbedderModelId", e.target.value)
													}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexEmbedderModelId,
													})}>
													<VSCodeOption value="" className="p-2">
														{t("settings:codeIndex.selectModel")}
													</VSCodeOption>
													{getAvailableModels().map((modelId) => {
														const model =
															codebaseIndexModels?.[
																currentSettings.codebaseIndexEmbedderProvider as keyof typeof codebaseIndexModels
															]?.[modelId]
														return (
															<VSCodeOption key={modelId} value={modelId} className="p-2">
																{modelId}{" "}
																{model
																	? t("settings:codeIndex.modelDimensions", {
																			dimension: model.dimension,
																		})
																	: ""}
															</VSCodeOption>
														)
													})}
												</VSCodeDropdown>
												{formErrors.codebaseIndexEmbedderModelId && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexEmbedderModelId}
													</p>
												)}
											</div>
										</>
									)}
									{/* kilocode_change end */}

									{/* Qdrant Settings */}
									{currentSettings.codebaseIndexVectorStoreProvider === "qdrant" && (
										<>
											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.qdrantUrlLabel")}
												</label>
												<VSCodeTextField
													value={currentSettings.codebaseIndexQdrantUrl || ""}
													onInput={(e: any) =>
														updateSetting("codebaseIndexQdrantUrl", e.target.value)
													}
													onBlur={(e: any) => {
														// Set default Qdrant URL if field is empty
														if (!e.target.value.trim()) {
															currentSettings.codebaseIndexQdrantUrl = DEFAULT_QDRANT_URL
															updateSetting("codebaseIndexQdrantUrl", DEFAULT_QDRANT_URL)
														}
													}}
													placeholder={t("settings:codeIndex.qdrantUrlPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codebaseIndexQdrantUrl,
													})}
												/>
												{formErrors.codebaseIndexQdrantUrl && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codebaseIndexQdrantUrl}
													</p>
												)}
											</div>

											<div className="space-y-2">
												<label className="text-sm font-medium">
													{t("settings:codeIndex.qdrantApiKeyLabel")}
												</label>
												<VSCodeTextField
													type="password"
													value={currentSettings.codeIndexQdrantApiKey || ""}
													onInput={(e: any) =>
														updateSetting("codeIndexQdrantApiKey", e.target.value)
													}
													placeholder={t("settings:codeIndex.qdrantApiKeyPlaceholder")}
													className={cn("w-full", {
														"border-red-500": formErrors.codeIndexQdrantApiKey,
													})}
												/>
												{formErrors.codeIndexQdrantApiKey && (
													<p className="text-xs text-vscode-errorForeground mt-1 mb-0">
														{formErrors.codeIndexQdrantApiKey}
													</p>
												)}
											</div>
										</>
									)}

									{/* kilocode_change start */}
									{/* LanceDB Vector Store Settings */}
									{currentSettings.codebaseIndexVectorStoreProvider === "lancedb" && (
										<div className="space-y-2">
											<label className="text-sm font-medium">
												{t("settings:codeIndex.lancedbVectorStoreDirectoryLabel")}
											</label>
											<VSCodeTextField
												value={currentSettings.codebaseIndexLancedbVectorStoreDirectory || ""}
												onInput={(e: any) =>
													updateSetting(
														"codebaseIndexLancedbVectorStoreDirectory",
														e.target.value,
													)
												}
												placeholder={t(
													"settings:codeIndex.lancedbVectorStoreDirectoryPlaceholder",
												)}
												className="w-full"
											/>
											<p className="text-xs text-vscode-descriptionForeground">
												{t("settings:codeIndex.lancedbVectorStoreDirectoryDescription")}
											</p>
										</div>
									)}
									{/* kilocode_change end */}
								</div>
							)}
						</div>

						{/* Advanced Settings Disclosure */}
						<div className="mt-4">
							<button
								onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
								className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus:outline-none"
								aria-expanded={isAdvancedSettingsOpen}>
								<span
									className={`codicon codicon-${isAdvancedSettingsOpen ? "chevron-down" : "chevron-right"} mr-1`}></span>
								<span className="text-base font-semibold">
									{t("settings:codeIndex.advancedConfigLabel")}
								</span>
							</button>

							{isAdvancedSettingsOpen && (
								<div className="mt-4 space-y-4">
									{/* Search Score Threshold Slider */}
									<div className="space-y-2">
										<div className="flex items-center gap-2">
											<label className="text-sm font-medium">
												{t("settings:codeIndex.searchMinScoreLabel")}
											</label>
											<StandardTooltip
												content={t("settings:codeIndex.searchMinScoreDescription")}>
												<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
											</StandardTooltip>
										</div>
										<div className="flex items-center gap-2">
											<Slider
												min={CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_SCORE}
												max={CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_SCORE}
												step={CODEBASE_INDEX_DEFAULTS.SEARCH_SCORE_STEP}
												value={[
													currentSettings.codebaseIndexSearchMinScore ??
														CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
												]}
												onValueChange={(values) =>
													updateSetting("codebaseIndexSearchMinScore", values[0])
												}
												className="flex-1"
												data-testid="search-min-score-slider"
											/>
											<span className="w-12 text-center">
												{(
													currentSettings.codebaseIndexSearchMinScore ??
													CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE
												).toFixed(2)}
											</span>
											<VSCodeButton
												appearance="icon"
												title={t("settings:codeIndex.resetToDefault")}
												onClick={() =>
													updateSetting(
														"codebaseIndexSearchMinScore",
														CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
													)
												}>
												<span className="codicon codicon-discard" />
											</VSCodeButton>
										</div>
									</div>

									{/* Maximum Search Results Slider */}
									<div className="space-y-2">
										<div className="flex items-center gap-2">
											<label className="text-sm font-medium">
												{t("settings:codeIndex.searchMaxResultsLabel")}
											</label>
											<StandardTooltip
												content={t("settings:codeIndex.searchMaxResultsDescription")}>
												<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
											</StandardTooltip>
										</div>
										<div className="flex items-center gap-2">
											<Slider
												min={CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS}
												max={CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS}
												step={CODEBASE_INDEX_DEFAULTS.SEARCH_RESULTS_STEP}
												value={[
													currentSettings.codebaseIndexSearchMaxResults ??
														CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
												]}
												onValueChange={(values) =>
													updateSetting("codebaseIndexSearchMaxResults", values[0])
												}
												className="flex-1"
												data-testid="search-max-results-slider"
											/>
											<span className="w-12 text-center">
												{currentSettings.codebaseIndexSearchMaxResults ??
													CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS}
											</span>
											<VSCodeButton
												appearance="icon"
												title={t("settings:codeIndex.resetToDefault")}
												onClick={() =>
													updateSetting(
														"codebaseIndexSearchMaxResults",
														CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
													)
												}>
												<span className="codicon codicon-discard" />
											</VSCodeButton>
										</div>
									</div>

									{/* kilocode_change start */}
									<EmbeddingBatchSizeSlider
										value={currentSettings.codebaseIndexEmbeddingBatchSize}
										onChange={(value) => updateSetting("codebaseIndexEmbeddingBatchSize", value)}
									/>

									<MaxBatchRetriesSlider
										value={currentSettings.codebaseIndexScannerMaxBatchRetries}
										onChange={(value) =>
											updateSetting("codebaseIndexScannerMaxBatchRetries", value)
										}
									/>
									{/* kilocode_change end */}
								</div>
							)}
						</div>

						{/* Action Buttons */}
						<div className="flex items-center justify-between gap-2 pt-6">
							<div className="flex gap-2">
								{/* kilocode_change start */}
								{currentSettings.codebaseIndexEnabled && indexingStatus.systemStatus === "Indexing" && (
									<VSCodeButton
										appearance="secondary"
										onClick={handleCancelIndexing}
										disabled={saveStatus === "saving"}>
										{t("settings:codeIndex.cancelIndexingButton")}
									</VSCodeButton>
								)}
								{/* kilocode_change end */}
								{currentSettings.codebaseIndexEnabled &&
									(indexingStatus.systemStatus === "Error" ||
										indexingStatus.systemStatus === "Standby") && (
										<Button
											onClick={() => vscode.postMessage({ type: "startIndexing" })}
											disabled={saveStatus === "saving" || hasUnsavedChanges}>
											{t("settings:codeIndex.startIndexingButton")}
										</Button>
									)}

								{currentSettings.codebaseIndexEnabled &&
									(indexingStatus.systemStatus === "Indexed" ||
										indexingStatus.systemStatus === "Error") && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button variant="secondary">
													{t("settings:codeIndex.clearIndexDataButton")}
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														{t("settings:codeIndex.clearDataDialog.title")}
													</AlertDialogTitle>
													<AlertDialogDescription>
														{t("settings:codeIndex.clearDataDialog.description")}
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>
														{t("settings:codeIndex.clearDataDialog.cancelButton")}
													</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => vscode.postMessage({ type: "clearIndexData" })}>
														{t("settings:codeIndex.clearDataDialog.confirmButton")}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									)}
							</div>

							<Button
								onClick={handleSaveSettings}
								disabled={!hasUnsavedChanges || saveStatus === "saving"}>
								{saveStatus === "saving"
									? t("settings:codeIndex.saving")
									: t("settings:codeIndex.saveSettings")}
							</Button>
						</div>

						{/* Save Status Messages */}
						{saveStatus === "error" && (
							<div className="mt-2">
								<span className="text-sm text-vscode-errorForeground block">
									{saveError || t("settings:codeIndex.saveError")}
								</span>
							</div>
						)}
					</div>
					{/* kilocode_change - PopoverContent -> MaybePopoverContent */}
				</MaybePopoverContent>
				{/* kilocode_change - Popover -> MaybePopover */}
			</MaybePopover>

			{/* Discard Changes Dialog */}
			<AlertDialog open={isDiscardDialogShow} onOpenChange={setDiscardDialogShow}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="flex items-center gap-2">
							<AlertTriangle className="w-5 h-5 text-yellow-500" />
							{t("settings:unsavedChangesDialog.title")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:unsavedChangesDialog.description")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => onConfirmDialogResult(false)}>
							{t("settings:unsavedChangesDialog.cancelButton")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => onConfirmDialogResult(true)}>
							{t("settings:unsavedChangesDialog.discardButton")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
