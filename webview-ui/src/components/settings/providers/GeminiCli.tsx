import { useCallback } from "react"
import { VSCodeTextField, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { inputEventTransform } from "../transforms"

type GeminiCliProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const GeminiCli = ({ apiConfiguration, setApiConfigurationField }: GeminiCliProps) => {
	const { t } = useAppTranslation()

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

	const routingEnabled = apiConfiguration?.geminiCliRouting?.enabled ?? true
	const simpleThreshold = apiConfiguration?.geminiCliRouting?.simpleThreshold ?? 50
	const showComplexity = apiConfiguration?.geminiCliRouting?.showComplexity ?? true

	const handleRoutingEnabledChange = useCallback(
		(e: any) => {
			const checked = e.target.checked
			setApiConfigurationField("geminiCliRouting", {
				...apiConfiguration?.geminiCliRouting,
				enabled: checked,
			})
		},
		[apiConfiguration?.geminiCliRouting, setApiConfigurationField],
	)

	const handleThresholdChange = useCallback(
		(e: any) => {
			const value = parseInt(e.target.value, 10)
			setApiConfigurationField("geminiCliRouting", {
				...apiConfiguration?.geminiCliRouting,
				simpleThreshold: value,
			})
		},
		[apiConfiguration?.geminiCliRouting, setApiConfigurationField],
	)

	const handleShowComplexityChange = useCallback(
		(e: any) => {
			const checked = e.target.checked
			setApiConfigurationField("geminiCliRouting", {
				...apiConfiguration?.geminiCliRouting,
				showComplexity: checked,
			})
		},
		[apiConfiguration?.geminiCliRouting, setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.geminiCliOAuthPath || ""}
				onInput={handleInputChange("geminiCliOAuthPath")}
				placeholder="~/.gemini/oauth_creds.json"
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.geminiCli.oauthPath")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.geminiCli.oauthPathDescription")}
			</div>

			<div className="mt-4 p-3 bg-vscode-editorWidget-background border border-vscode-editorWidget-border rounded">
				<div className="flex items-center gap-2 mb-3">
					<i className="codicon codicon-lightbulb text-vscode-notificationsInfoIcon-foreground" />
					<span className="font-semibold text-sm">Intelligent Model Router</span>
				</div>
				<div className="text-sm text-vscode-descriptionForeground mb-3">
					Automatically selects the optimal model based on task complexity. Simple tasks use gemini-2.5-flash
					(faster, cheaper), while complex tasks use gemini-2.5-pro (more capable).
				</div>

				<VSCodeCheckbox checked={routingEnabled} onChange={handleRoutingEnabledChange} className="mt-2">
					Enable Intelligent Routing
				</VSCodeCheckbox>
				<div className="text-xs text-vscode-descriptionForeground mt-1 ml-6">
					When enabled, tasks are automatically routed to the best model for their complexity
				</div>

				{routingEnabled && (
					<>
						<div className="mt-3 ml-6">
							<label className="block text-sm font-medium mb-2">
								Complexity Threshold: {simpleThreshold}%
							</label>
							<input
								type="range"
								min="0"
								max="100"
								value={simpleThreshold}
								onInput={handleThresholdChange}
								className="w-full"
								style={{ accentColor: "var(--vscode-button-background)" }}
							/>
							<div className="flex justify-between text-xs text-vscode-descriptionForeground mt-1">
								<span>← Flash (Simple)</span>
								<span>Pro (Complex) →</span>
							</div>
							<div className="text-xs text-vscode-descriptionForeground mt-1">
								Tasks below {simpleThreshold}% complexity use gemini-2.5-flash, others use
								gemini-2.5-pro
							</div>
						</div>

						<VSCodeCheckbox
							checked={showComplexity}
							onChange={handleShowComplexityChange}
							className="mt-3 ml-6">
							Show complexity score in responses
						</VSCodeCheckbox>
						<div className="text-xs text-vscode-descriptionForeground mt-1 ml-12">
							Display [auto] indicator with model and complexity percentage
						</div>
					</>
				)}
			</div>

			<div className="text-sm text-vscode-descriptionForeground mt-3">
				{t("settings:providers.geminiCli.description")}
			</div>

			<div className="text-sm text-vscode-descriptionForeground mt-2">
				{t("settings:providers.geminiCli.instructions")}{" "}
				<code className="text-vscode-textPreformat-foreground">gemini</code>{" "}
				{t("settings:providers.geminiCli.instructionsContinued")}
			</div>

			<VSCodeLink
				href="https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#quickstart"
				className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground mt-2 inline-block">
				{t("settings:providers.geminiCli.setupLink")}
			</VSCodeLink>

			<div className="mt-3 p-3 bg-vscode-editorWidget-background border border-vscode-editorWidget-border rounded">
				<div className="flex items-center gap-2 mb-2">
					<i className="codicon codicon-warning text-vscode-notificationsWarningIcon-foreground" />
					<span className="font-semibold text-sm">{t("settings:providers.geminiCli.requirementsTitle")}</span>
				</div>
				<ul className="list-disc list-inside space-y-1 text-sm text-vscode-descriptionForeground">
					<li>{t("settings:providers.geminiCli.requirement1")}</li>
					<li>{t("settings:providers.geminiCli.requirement2")}</li>
					<li>{t("settings:providers.geminiCli.requirement3")}</li>
					<li>{t("settings:providers.geminiCli.requirement4")}</li>
					<li>{t("settings:providers.geminiCli.requirement5")}</li>
				</ul>
			</div>

			<div className="mt-3 flex items-center gap-2">
				<i className="codicon codicon-check text-vscode-notificationsInfoIcon-foreground" />
				<span className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.geminiCli.freeAccess")}
				</span>
			</div>
		</>
	)
}
