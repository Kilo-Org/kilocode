// kilocode_change start: Added useState, useEffect for inference profile resolution
import { useMemo, useState, useEffect, useCallback } from "react"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { validateBedrockArn } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
// kilocode_change end

type BedrockCustomArnProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	onResolvedModelInfo?: (modelId: string | null) => void // kilocode_change: Callback to notify parent of resolved model
}

export const BedrockCustomArn = ({
	apiConfiguration,
	setApiConfigurationField,
	onResolvedModelInfo,
}: BedrockCustomArnProps) => {
	const { t } = useAppTranslation()

	// kilocode_change start: State for inference profile resolution
	const [isResolving, setIsResolving] = useState(false)
	const [resolvedModelId, setResolvedModelId] = useState<string | null>(null)
	const [resolutionError, setResolutionError] = useState<string | null>(null)
	// kilocode_change end

	const validation = useMemo(() => {
		const { awsCustomArn, awsRegion } = apiConfiguration
		return awsCustomArn ? validateBedrockArn(awsCustomArn, awsRegion) : { isValid: true, errorMessage: undefined }
	}, [apiConfiguration])

	// kilocode_change start: Effect to listen for resolution responses
	// Function to trigger ARN resolution
	const handleResolveArn = useCallback(() => {
		const { awsCustomArn } = apiConfiguration
		if (!awsCustomArn || !validation.isValid) return

		setIsResolving(true)
		setResolutionError(null)
		vscode.postMessage({
			type: "resolveBedrockInferenceProfile",
			text: awsCustomArn,
		})
	}, [apiConfiguration, validation.isValid])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "bedrockInferenceProfileResolved") {
				setIsResolving(false)
				if (message.bedrockInferenceModelId) {
					setResolvedModelId(message.bedrockInferenceModelId)
					setResolutionError(null)
					// Notify parent component about resolved model
					if (onResolvedModelInfo) {
						onResolvedModelInfo(message.bedrockInferenceModelId)
					}
				} else if (message.error) {
					setResolutionError(message.error)
					setResolvedModelId(null)
					// Clear resolved model info on error
					if (onResolvedModelInfo) {
						onResolvedModelInfo(null)
					}
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [onResolvedModelInfo])

	// Effect to automatically resolve when ARN changes and is valid
	useEffect(() => {
		const awsCustomArn = apiConfiguration.awsCustomArn

		// Clear previous resolution state when ARN changes
		setResolvedModelId(null)
		setResolutionError(null)

		// Clear resolved model info in parent
		if (onResolvedModelInfo) {
			onResolvedModelInfo(null)
		}

		// Only auto-resolve for application-inference-profile and inference-profile ARNs
		if (
			awsCustomArn &&
			validation.isValid &&
			(awsCustomArn.includes(":application-inference-profile/") || awsCustomArn.includes(":inference-profile/"))
		) {
			handleResolveArn()
		}
	}, [apiConfiguration.awsCustomArn, validation.isValid, onResolvedModelInfo, handleResolveArn])
	// kilocode_change end

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.awsCustomArn || ""}
				onInput={(e) => setApiConfigurationField("awsCustomArn", (e.target as HTMLInputElement).value)}
				placeholder={t("settings:placeholders.customArn")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:labels.customArn")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.awsCustomArnUse")}
				<ul className="list-disc pl-5 mt-1">
					<li>
						arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-3-7-sonnet-20250219-v1:0
					</li>
					<li>arn:aws:bedrock:eu-west-1:995555607786:application-inference-profile/pq08tvm5w5bm</li>
					<li>arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-provisioned-model</li>
					<li>arn:aws:bedrock:us-east-1:123456789012:default-prompt-router/anthropic.claude:1</li>
				</ul>
				{t("settings:providers.awsCustomArnDesc")}
			</div>
			{!validation.isValid ? (
				<div className="text-sm text-vscode-errorForeground mt-2">
					{validation.errorMessage || t("settings:providers.invalidArnFormat")}
				</div>
			) : (
				validation.errorMessage && (
					<div className="text-sm text-vscode-errorForeground mt-2">{validation.errorMessage}</div>
				)
			)}

			{/* kilocode_change start: Show inference profile resolution status */}
			{validation.isValid &&
				apiConfiguration?.awsCustomArn &&
				(apiConfiguration.awsCustomArn.includes(":application-inference-profile/") ||
					apiConfiguration.awsCustomArn.includes(":inference-profile/")) && (
					<div className="mt-3 p-3 border border-vscode-panel-border rounded">
						<div className="flex items-center justify-between mb-2">
							<div className="text-sm font-medium">
								{t("settings:providers.awsInferenceProfileResolution")}
							</div>
							<VSCodeButton appearance="secondary" onClick={handleResolveArn} disabled={isResolving}>
								{isResolving ? (
									<span className="flex items-center gap-2">
										<i className="codicon codicon-loading codicon-modifier-spin" />
										{t("settings:providers.awsInferenceProfileResolving")}
									</span>
								) : (
									<span className="flex items-center gap-2">
										<i className="codicon codicon-refresh" />
										{t("settings:providers.awsInferenceProfileResolve")}
									</span>
								)}
							</VSCodeButton>
						</div>
						{resolvedModelId && (
							<div className="mt-2 p-2 bg-vscode-textBlockQuote-background rounded">
								<div className="text-sm">
									<span className="text-vscode-descriptionForeground">
										{t("settings:providers.awsInferenceProfileUnderlyingModel")}
									</span>
									<span className="font-mono text-vscode-textPreformat-foreground">
										{resolvedModelId}
									</span>
								</div>
								<div className="text-xs text-vscode-descriptionForeground mt-1">
									{t("settings:providers.awsInferenceProfileCapabilitiesNote")}
								</div>
							</div>
						)}
						{resolutionError && (
							<div className="mt-2 p-2 bg-vscode-inputValidation-errorBackground border border-vscode-inputValidation-errorBorder rounded">
								<div className="text-sm text-vscode-errorForeground">
									<i className="codicon codicon-error mr-1" />
									{resolutionError}
								</div>
							</div>
						)}
						{!resolvedModelId && !resolutionError && !isResolving && (
							<div className="text-xs text-vscode-descriptionForeground mt-2">
								{t("settings:providers.awsInferenceProfileClickResolve")}
							</div>
						)}
					</div>
				)}
			{/* kilocode_change end */}
		</>
	)
}
