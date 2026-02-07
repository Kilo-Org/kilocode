import React from "react"

import { type ProviderSettings, claudeCodeDefaultModelId, claudeCodeModels } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { ModelPicker } from "../ModelPicker"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

interface ClaudeCodeProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const ClaudeCode: React.FC<ClaudeCodeProps> = ({
	apiConfiguration,
	setApiConfigurationField,
	simplifySettings,
}) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-4">
			{/* CLI Path (optional) */}
			<div className="flex flex-col gap-2">
				<VSCodeTextField
					value={apiConfiguration.claudeCodePath || ""}
					placeholder="claude"
					onInput={(e) =>
						setApiConfigurationField("claudeCodePath", (e.target as HTMLInputElement).value || undefined)
					}>
					<span className="font-medium">
						{t("settings:providers.claudeCode.pathLabel", {
							defaultValue: "Claude CLI Path (optional)",
						})}
					</span>
				</VSCodeTextField>
				<p className="text-xs text-vscode-descriptionForeground">
					{t("settings:providers.claudeCode.pathDescription", {
						defaultValue:
							"Path to the Claude Code CLI executable. Leave empty to use 'claude' from PATH. You must be authenticated via 'claude login' in your terminal.",
					})}
				</p>
			</div>

			{/* Model Picker */}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={claudeCodeDefaultModelId}
				models={claudeCodeModels}
				modelIdKey="apiModelId"
				serviceName="Claude Code"
				serviceUrl="https://claude.ai"
				simplifySettings={simplifySettings}
				hidePricing
			/>
		</div>
	)
}
