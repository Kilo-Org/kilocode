import React, { useMemo, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { IMAGE_GENERATION_MODELS, type ImageGenerationProvider, getImageGenerationProvider } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { getAppUrl } from "@roo-code/types"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	imageGenerationProvider?: ImageGenerationProvider
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setImageGenerationProvider: (provider: ImageGenerationProvider) => void
	setOpenRouterImageApiKey: (apiKey: string) => void
	setImageGenerationSelectedModel: (model: string) => void
	// kilocode_change start
	kiloCodeImageApiKey?: string
	setKiloCodeImageApiKey: (apiKey: string) => void
	currentProfileKilocodeToken?: string
	// kilocode_change end
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	imageGenerationProvider,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setImageGenerationProvider,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
	// kilocode_change start
	kiloCodeImageApiKey,
	setKiloCodeImageApiKey,
	currentProfileKilocodeToken,
	// kilocode_change end
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// Use shared utility for backwards compatibility logic
	const currentProvider = getImageGenerationProvider(
		imageGenerationProvider,
		!!openRouterImageGenerationSelectedModel,
	)

	// kilocode_change start
	useEffect(() => {
		if (!enabled) {
			return
		}
		if (currentProvider !== "openrouter" && openRouterImageApiKey) {
			setOpenRouterImageApiKey("")
		}
	}, [enabled, currentProvider, openRouterImageApiKey, setOpenRouterImageApiKey])
	// kilocode_change end

	const availableModels = useMemo(() => {
		return IMAGE_GENERATION_MODELS.filter((model) => model.provider === currentProvider)
	}, [currentProvider])

	// Derive the current model value - either from props or first available
	const currentModel = useMemo(() => {
		// If we have a stored model, verify it exists for the current provider
		// (check both value and provider since some models have duplicate values)
		if (openRouterImageGenerationSelectedModel) {
			// Find a model that matches BOTH the value AND the current provider
			const modelInfo = IMAGE_GENERATION_MODELS.find(
				(m) => m.value === openRouterImageGenerationSelectedModel && m.provider === currentProvider,
			)
			if (modelInfo) {
				return openRouterImageGenerationSelectedModel
			}
		}
		// Otherwise use first available model for current provider
		return availableModels[0]?.value || IMAGE_GENERATION_MODELS[0].value
	}, [openRouterImageGenerationSelectedModel, availableModels, currentProvider])

	// Handle provider changes
	// kilocode_change: unused for now
	const handleProviderChange = (value: string) => {
		const newProvider = value as ImageGenerationProvider
		setImageGenerationProvider(newProvider)

		// Smart model selection when switching providers:
		// 1. If current model exists for new provider (same model name), keep it
		// 2. Otherwise, switch to first available model for new provider
		const providerModels = IMAGE_GENERATION_MODELS.filter((m) => m.provider === newProvider)
		if (providerModels.length > 0) {
			// Check if current model exists for new provider
			const currentModelForNewProvider = providerModels.find(
				(m) => m.value === openRouterImageGenerationSelectedModel,
			)
			if (currentModelForNewProvider) {
				// Current model exists for new provider, keep it
				// No need to call setImageGenerationSelectedModel since the value doesn't change
			} else {
				// Current model doesn't exist for new provider, switch to first available
				setImageGenerationSelectedModel(providerModels[0].value)
			}
		}
	}

	// Handle API key changes
	const handleApiKeyChange = (value: string) => {
		setOpenRouterImageApiKey(value)
	}

	const handleKiloApiKeyChange = (value: string) => {
		setKiloCodeImageApiKey(value)
	}

	// Handle model selection changes
	const handleModelChange = (value: string) => {
		setImageGenerationSelectedModel(value)
	}

	const isConfigured = currentProvider === "openrouter" ? openRouterImageApiKey : kiloCodeImageApiKey // kilocode_change

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					{/* Provider Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.providerLabel")}
						</label>
						<VSCodeDropdown
							value={currentProvider}
							onChange={(e: any) => handleProviderChange(e.target.value)}
							className="w-full">
							<VSCodeOption value="kilocode" className="py-2 px-3">
								Kilo Gateway
							</VSCodeOption>
							<VSCodeOption value="openrouter" className="py-2 px-3">
								OpenRouter
							</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.providerDescription")}
						</p>
					</div>

					{/* {
						// kilocode_change start
						<div>
							<label className="block font-medium mb-1">
								{t("settings:experimental.IMAGE_GENERATION.apiProvider")}
							</label>
							<VSCodeDropdown
								value={isUsingOpenRouter ? "openrouter" : "kilocode"}
								onChange={(e: any) => {
									console.log("onChange", Boolean(e.target.value))
									setIsUsingOpenRouter(e.target.value === "openrouter")
								}}
								className="w-full">
								<VSCodeOption className="py-2 px-3" value="kilocode">
									Kilo Code
								</VSCodeOption>
								<VSCodeOption className="py-2 px-3" value="openrouter">
									OpenRouter
								</VSCodeOption>
							</VSCodeDropdown>
						</div>
						// kilocode_change end
					} */}

					{
						// kilocode_change start
						<div style={{ display: currentProvider === "openrouter" ? "none" : undefined }}>
							<label className="block font-medium mb-1">
								{t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyLabel")}
							</label>
							<VSCodeTextField
								value={kiloCodeImageApiKey}
								onInput={(e: any) => handleKiloApiKeyChange(e.target.value)}
								placeholder={t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyPlaceholder")}
								className="w-full"
								type="password"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{currentProfileKilocodeToken ? (
									<a
										href="#"
										onClick={() => handleKiloApiKeyChange(currentProfileKilocodeToken)}
										className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
										{t("settings:experimental.IMAGE_GENERATION.kiloCodeApiKeyPaste")}
									</a>
								) : (
									<>
										{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
										<a
											href={getAppUrl("/profile?personal=true")}
											target="_blank"
											rel="noopener noreferrer"
											className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
											{getAppUrl("/profile")}
										</a>
									</>
								)}
							</p>
						</div>
						// kilocode_change end
					}

					{/* API Key Configuration (only for OpenRouter) */}
					{currentProvider === "openrouter" && (
						<div>
							<label className="block font-medium mb-1">
								{t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyLabel")}
							</label>
							<VSCodeTextField
								value={openRouterImageApiKey || ""}
								onInput={(e: any) => handleApiKeyChange(e.target.value)}
								placeholder={t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder")}
								className="w-full"
								type="password"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
								<a
									href="https://openrouter.ai/keys"
									target="_blank"
									rel="noopener noreferrer"
									className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
									openrouter.ai/keys
								</a>
							</p>
						</div>
					)}

					{/* Model Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						<VSCodeDropdown
							value={currentModel}
							onChange={(e: any) => handleModelChange(e.target.value)}
							className="w-full">
							{availableModels.map((model) => (
								<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
									{model.label}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
						</p>
					</div>

					{/* Status Message */}
					{enabled && !isConfigured && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && isConfigured && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
