import * as ProgressPrimitive from "@radix-ui/react-progress"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { AlertTriangle } from "lucide-react"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Trans } from "react-i18next"
import { z } from "zod"

import { CODEBASE_INDEX_DEFAULTS } from "@roo-code/types"

import type { EmbedderProvider } from "@roo/embeddingModels"
import type { IndexingStatus } from "@roo/ExtensionMessage"

import {
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
	StandardTooltip,
} from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { buildDocLink } from "@src/utils/docLinks"
import { vscode } from "@src/utils/vscode"

// Default URLs for providers
// const DEFAULT_QDRANT_URL = "http://localhost:6333"
// const DEFAULT_OLLAMA_URL = "http://localhost:11434"

interface CodeIndexPopoverProps {
	children: React.ReactNode
	indexingStatus: IndexingStatus
}

interface LocalCodeIndexSettings {
	// Global state settings
	codebaseIndexEnabled: boolean
	codebaseIndexQdrantUrl: string
	codebaseIndexEmbedderProvider: EmbedderProvider
	codebaseIndexEmbedderBaseUrl?: string
	codebaseIndexEmbedderModelId: string
	codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
	codebaseIndexSearchMaxResults?: number
	codebaseIndexSearchMinScore?: number

	// Secret settings (start empty, will be loaded separately)
	codeIndexOpenAiKey?: string
	codeIndexQdrantApiKey?: string
	codebaseIndexOpenAiCompatibleBaseUrl?: string
	codebaseIndexOpenAiCompatibleApiKey?: string
	codebaseIndexGeminiApiKey?: string
	codebaseIndexMistralApiKey?: string
	codebaseIndexVercelAiGatewayApiKey?: string
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

		default:
			return baseSchema
	}
}

export const CodeIndexPopover: React.FC<CodeIndexPopoverProps> = ({
	children,
	indexingStatus: externalIndexingStatus,
}) => {
	const SECRET_PLACEHOLDER = "••••••••••••••••"
	const { t } = useAppTranslation()
	const { codebaseIndexConfig, cwd } = useExtensionState()
	const [open, setOpen] = useState(false)
	// const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)
	// const [isSetupSettingsOpen, setIsSetupSettingsOpen] = useState(false)

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
		codebaseIndexEmbedderBaseUrl: "",
		codebaseIndexEmbedderModelId: "",
		codebaseIndexEmbedderModelDimension: undefined,
		codebaseIndexSearchMaxResults: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
		codebaseIndexSearchMinScore: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
		codeIndexOpenAiKey: "",
		codeIndexQdrantApiKey: "",
		codebaseIndexOpenAiCompatibleBaseUrl: "",
		codebaseIndexOpenAiCompatibleApiKey: "",
		codebaseIndexGeminiApiKey: "",
		codebaseIndexMistralApiKey: "",
		codebaseIndexVercelAiGatewayApiKey: "",
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
		if (codebaseIndexConfig) {
			const settings = {
				codebaseIndexEnabled: codebaseIndexConfig.codebaseIndexEnabled ?? true,
				codebaseIndexQdrantUrl: codebaseIndexConfig.codebaseIndexQdrantUrl || "",
				codebaseIndexEmbedderProvider: codebaseIndexConfig.codebaseIndexEmbedderProvider || "openai",
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig.codebaseIndexEmbedderBaseUrl || "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig.codebaseIndexEmbedderModelId || "",
				codebaseIndexEmbedderModelDimension:
					codebaseIndexConfig.codebaseIndexEmbedderModelDimension || undefined,
				codebaseIndexSearchMaxResults:
					codebaseIndexConfig.codebaseIndexSearchMaxResults ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
				codebaseIndexSearchMinScore:
					codebaseIndexConfig.codebaseIndexSearchMinScore ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
				codeIndexOpenAiKey: "",
				codeIndexQdrantApiKey: "",
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl || "",
				codebaseIndexOpenAiCompatibleApiKey: "",
				codebaseIndexGeminiApiKey: "",
				codebaseIndexMistralApiKey: "",
				codebaseIndexVercelAiGatewayApiKey: "",
			}
			setInitialSettings(settings)
			setCurrentSettings(settings)

			// Request secret status to check if secrets exist
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
	}, [codebaseIndexConfig])

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
					key === "codebaseIndexVercelAiGatewayApiKey"
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

	// Handle popover close with unsaved changes check
	const handlePopoverClose = useCallback(() => {
		checkUnsavedChanges(() => {
			setOpen(false)
		})
	}, [checkUnsavedChanges])

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

	// const getAvailableModels = () => {
	// 	if (!codebaseIndexModels) return []

	// 	const models = codebaseIndexModels[currentSettings.codebaseIndexEmbedderProvider]
	// 	return models ? Object.keys(models) : []
	// }

	const portalContainer = useRooPortal("roo-portal")

	return (
		<>
			<Popover
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
				<PopoverContent
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
										<VSCodeButton
											onClick={() => vscode.postMessage({ type: "startIndexing" })}
											disabled={saveStatus === "saving" || hasUnsavedChanges}>
											{t("settings:codeIndex.startIndexingButton")}
										</VSCodeButton>
									)}

								{currentSettings.codebaseIndexEnabled &&
									(indexingStatus.systemStatus === "Indexed" ||
										indexingStatus.systemStatus === "Error") && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<VSCodeButton appearance="secondary">
													{t("settings:codeIndex.clearIndexDataButton")}
												</VSCodeButton>
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
												<AlertDialogFooter className="flex-col gap-2 items-center justify-center">
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

							<VSCodeButton
								onClick={handleSaveSettings}
								disabled={!hasUnsavedChanges || saveStatus === "saving"}>
								{saveStatus === "saving"
									? t("settings:codeIndex.saving")
									: t("settings:codeIndex.saveSettings")}
							</VSCodeButton>
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
				</PopoverContent>
			</Popover>

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
