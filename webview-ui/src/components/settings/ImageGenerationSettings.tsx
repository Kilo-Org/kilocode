import React, { useState, useEffect } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { getAppUrl } from "@roo-code/types"

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	openRouterImageApiKey?: string
	openRouterImageGenerationSelectedModel?: string
	setOpenRouterImageApiKey: (apiKey: string) => void
	setImageGenerationSelectedModel: (model: string) => void
	// kilocode_change start
	kiloCodeImageApiKey?: string
	setKiloCodeImageApiKey: (apiKey: string) => void
	currentProfileKilocodeToken?: string
	// kilocode_change end
}

// Hardcoded list of image generation models
const IMAGE_GENERATION_MODELS = [
	{ value: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
	{ value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" }, // kilocode_change
	{ value: "openai/gpt-5-image", label: "GPT-5 Image" },
	{ value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini" },
	// Add more models as they become available
]

export const ImageGenerationSettings = ({
	enabled,
	onChange,
	openRouterImageApiKey,
	openRouterImageGenerationSelectedModel,
	setOpenRouterImageApiKey,
	setImageGenerationSelectedModel,
	// kilocode_change start
	kiloCodeImageApiKey,
	setKiloCodeImageApiKey,
	currentProfileKilocodeToken,
	// kilocode_change end
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	// kilocode_change start
	const [isUsingOpenRouter, setIsUsingOpenRouter] = useState(!!openRouterImageApiKey)
	useEffect(() => {
		if (!enabled) {
			return
		}
		const paidImageGenerationModel = IMAGE_GENERATION_MODELS[0].value
		if (isUsingOpenRouter) {
			if (!openRouterImageGenerationSelectedModel) {
				setImageGenerationSelectedModel(paidImageGenerationModel)
			}
		} else {
			if (openRouterImageApiKey) {
				setOpenRouterImageApiKey("")
			}
			if (openRouterImageGenerationSelectedModel !== paidImageGenerationModel) {
				setImageGenerationSelectedModel(paidImageGenerationModel)
			}
		}
	}, [
		enabled,
		isUsingOpenRouter,
		openRouterImageApiKey,
		setOpenRouterImageApiKey,
		kiloCodeImageApiKey,
		setKiloCodeImageApiKey,
		openRouterImageGenerationSelectedModel,
		setImageGenerationSelectedModel,
		currentProfileKilocodeToken,
	])
	// kilocode_change end

	// Handle API key changes
	const handleApiKeyChange = (value: string) => {
		// setApiKey(value) // kilocode_change
		setOpenRouterImageApiKey(value)
	}

	const handleKiloApiKeyChange = (value: string) => {
		setKiloCodeImageApiKey(value)
	}

	// Handle model selection changes
	const handleModelChange = (value: string) => {
		// setSelectedModel(value) // kilocode_change
		setImageGenerationSelectedModel(value)
	}

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
					{/* API Key Configuration */}

					{
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
					}

					{
						// kilocode_change start
						<div style={{ display: isUsingOpenRouter ? "none" : undefined }}>
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

					<div style={{ display: isUsingOpenRouter ? undefined : "none" } /*kilocode_change*/}>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.openRouterApiKeyLabel")}
						</label>
						<VSCodeTextField
							value={openRouterImageApiKey /*kilocode_change*/}
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

					{/* Model Selection */}
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						<VSCodeDropdown
							value={openRouterImageGenerationSelectedModel /*kilocode_change*/}
							onChange={(e: any) => handleModelChange(e.target.value)}
							className="w-full">
							{IMAGE_GENERATION_MODELS.map((model) => (
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
					{enabled && (isUsingOpenRouter ? !openRouterImageApiKey : !kiloCodeImageApiKey) && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingKey")}
						</div>
					)}

					{enabled && (isUsingOpenRouter ? openRouterImageApiKey : kiloCodeImageApiKey) && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured")}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
