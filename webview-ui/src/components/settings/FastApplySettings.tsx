import React, { useState, useEffect } from "react"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"

interface FastApplySettingsProps {
	morphApiKey?: string
	fastApplyModel?: string
	fastApplyProviderType?: "morph" | "openrouter" | "kilocode"
	fastApplyProfileId?: string
	setMorphApiKey: (apiKey: string) => void
	setFastApplyModel: (model: string) => void
	setFastApplyProviderType: (providerType: "morph" | "openrouter" | "kilocode") => void
	setFastApplyProfileId: (profileId: string) => void
}

const FAST_APPLY_MODELS = [
	{ value: "auto", label: "Auto" },
	{ value: "morph/morph-v3-fast", label: "Morph v3 Fast" },
	{ value: "morph/morph-v3-large", label: "Morph v3 Large" },
	{ value: "relace/relace-apply-3", label: "Relace Apply 3" },
]

export const FastApplySettings = ({
	morphApiKey,
	fastApplyModel,
	fastApplyProviderType,
	fastApplyProfileId,
	setMorphApiKey,
	setFastApplyModel,
	setFastApplyProviderType,
	setFastApplyProfileId,
}: FastApplySettingsProps) => {
	const { t } = useAppTranslation()
	const { listApiConfigMeta = [] } = useExtensionState()

	// Local state to track which provider is selected (like isUsingOpenRouter)
	const [currentProviderType, setCurrentProviderType] = useState<"morph" | "openrouter" | "kilocode">(
		fastApplyProviderType || "morph",
	)

	// DEBUG: Log when props are received
	useEffect(() => {
		console.log("[FastApplySettings] Props received:", {
			fastApplyProviderType,
			fastApplyProfileId,
			morphApiKey: morphApiKey ? `***${morphApiKey.length}chars` : undefined,
			fastApplyModel,
		})
	}, [fastApplyProviderType, fastApplyProfileId, morphApiKey, fastApplyModel])

	// Effect to handle side effects like default models (like ImageGenerationSettings lines 43-70)
	useEffect(() => {
		const defaultModel = FAST_APPLY_MODELS[0].value

		// Ensure model has a default value
		if (!fastApplyModel) {
			setFastApplyModel(defaultModel)
		}
	}, [fastApplyModel, setFastApplyModel])

	// Get available profiles
	const openRouterProfiles = listApiConfigMeta.filter((profile) => profile.apiProvider === "openrouter")
	const kiloCodeProfiles = listApiConfigMeta.filter((profile) => profile.apiProvider === "kilocode")
	const selectedProfile = listApiConfigMeta.find((profile) => profile.id === fastApplyProfileId)

	// Handler functions (like lines 74-87)
	const handleMorphApiKeyChange = (value: string) => {
		setMorphApiKey(value)
	}

	const handleModelChange = (value: string) => {
		setFastApplyModel(value)
	}

	const handleProfileIdChange = (value: string) => {
		setFastApplyProfileId(value)
	}

	// Determine if configuration is valid
	const isConfigValid = () => {
		if (currentProviderType === "morph") {
			return morphApiKey && morphApiKey.trim() !== ""
		} else {
			const profiles = currentProviderType === "openrouter" ? openRouterProfiles : kiloCodeProfiles
			return profiles.length > 0 && fastApplyProfileId && selectedProfile?.apiProvider === currentProviderType
		}
	}

	return (
		<div className="flex flex-col gap-3">
			{/* Provider Type Selector */}
			<div>
				<label className="text-xs text-vscode-descriptionForeground mb-1 block">
					{t("settings:experimental.MORPH_FAST_APPLY.providerTypeLabel")}
				</label>
				<VSCodeDropdown
					value={currentProviderType}
					onChange={(e: any) => {
						const newValue = (e.target as any)?.value || "morph"
						// Update local state AND parent (this is where user action happens)
						setCurrentProviderType(newValue)
						setFastApplyProviderType(newValue)
					}}
					className="w-full">
					<VSCodeOption value="morph">
						{t("settings:experimental.MORPH_FAST_APPLY.providerTypes.morph")}
					</VSCodeOption>
					<VSCodeOption value="openrouter">
						{t("settings:experimental.MORPH_FAST_APPLY.providerTypes.openrouter")}
					</VSCodeOption>
					<VSCodeOption value="kilocode">
						{t("settings:experimental.MORPH_FAST_APPLY.providerTypes.kilocode")}
					</VSCodeOption>
				</VSCodeDropdown>
			</div>

			{/* Morph API Key Input */}
			{currentProviderType === "morph" && (
				<VSCodeTextField
					type="password"
					value={morphApiKey || ""}
					placeholder={t("settings:experimental.MORPH_FAST_APPLY.placeholder")}
					onInput={(e: any) => handleMorphApiKeyChange((e.target as any)?.value || "")}
					className="w-full">
					{t("settings:experimental.MORPH_FAST_APPLY.apiKey")}
				</VSCodeTextField>
			)}

			{/* OpenRouter Profile Selector */}
			{currentProviderType === "openrouter" && (
				<div>
					<label className="text-xs text-vscode-descriptionForeground mb-1 block">
						{t("settings:experimental.MORPH_FAST_APPLY.profileLabel")}
					</label>
					{openRouterProfiles.length > 0 ? (
						<VSCodeDropdown
							value={fastApplyProfileId || ""}
							onChange={(e: any) => handleProfileIdChange((e.target as any)?.value || "")}
							className="w-full">
							<VSCodeOption value="" disabled>
								{t("settings:experimental.MORPH_FAST_APPLY.selectProfile")}
							</VSCodeOption>
							{openRouterProfiles.map((profile) => (
								<VSCodeOption key={profile.id} value={profile.id}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					) : (
						<p className="text-xs text-vscode-descriptionForeground mt-1">
							{t("settings:experimental.MORPH_FAST_APPLY.noOpenRouterProfiles")}
						</p>
					)}
				</div>
			)}

			{/* KiloCode Profile Selector */}
			{currentProviderType === "kilocode" && (
				<div>
					<label className="text-xs text-vscode-descriptionForeground mb-1 block">
						{t("settings:experimental.MORPH_FAST_APPLY.profileLabel")}
					</label>
					{kiloCodeProfiles.length > 0 ? (
						<VSCodeDropdown
							value={fastApplyProfileId || ""}
							onChange={(e: any) => handleProfileIdChange((e.target as any)?.value || "")}
							className="w-full">
							<VSCodeOption value="" disabled>
								{t("settings:experimental.MORPH_FAST_APPLY.selectProfile")}
							</VSCodeOption>
							{kiloCodeProfiles.map((profile) => (
								<VSCodeOption key={profile.id} value={profile.id}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					) : (
						<p className="text-xs text-vscode-descriptionForeground mt-1">
							{t("settings:experimental.MORPH_FAST_APPLY.noKiloCodeProfiles")}
						</p>
					)}
				</div>
			)}

			{/* Model Selection */}
			<div>
				<label className="text-xs text-vscode-descriptionForeground mb-1 block">
					{t("settings:experimental.MORPH_FAST_APPLY.modelLabel")}
				</label>
				<VSCodeDropdown
					value={fastApplyModel || "auto"}
					onChange={(e: any) => handleModelChange((e.target as any)?.value || "auto")}
					className="w-full">
					{FAST_APPLY_MODELS.map((model) => (
						<VSCodeOption key={model.value} value={model.value}>
							{model.label}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:experimental.MORPH_FAST_APPLY.modelDescription")}
				</p>
			</div>

			{/* Warning Message */}
			{!isConfigValid() && (
				<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
					{t("settings:experimental.MORPH_FAST_APPLY.warningInvalidConfig")}
				</div>
			)}

			{/* Success Message */}
			{isConfigValid() && (
				<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
					{t("settings:experimental.MORPH_FAST_APPLY.successConfigured")}
				</div>
			)}
		</div>
	)
}
