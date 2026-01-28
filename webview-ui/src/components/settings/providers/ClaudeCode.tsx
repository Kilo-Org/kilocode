import React from "react"

import { type ProviderSettings, claudeCodeDefaultModelId, claudeCodeModels } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

import { ModelPicker } from "../ModelPicker"
import { ClaudeCodeRateLimitDashboard } from "./ClaudeCodeRateLimitDashboard"

interface ClaudeCodeProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
	claudeCodeIsAuthenticated?: boolean
}

export const ClaudeCode: React.FC<ClaudeCodeProps> = ({
	apiConfiguration,
	setApiConfigurationField,
	simplifySettings,
	claudeCodeIsAuthenticated = false,
}) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col gap-4">
			{/* Authentication Section */}
			<div className="flex flex-col gap-2">
				{claudeCodeIsAuthenticated ? (
					<div className="flex justify-end">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => vscode.postMessage({ type: "claudeCodeSignOut" })}>
							{t("settings:providers.claudeCode.signOutButton", {
								defaultValue: "Sign Out",
							})}
						</Button>
					</div>
				) : (
					<Button
						variant="primary"
						onClick={() => vscode.postMessage({ type: "claudeCodeSignIn" })}
						className="w-fit">
						{t("settings:providers.claudeCode.signInButton", {
							defaultValue: "Sign in to Claude Code",
						})}
					</Button>
				)}
			</div>

			{/* Rate Limit Dashboard - only shown when authenticated */}
			<ClaudeCodeRateLimitDashboard isAuthenticated={claudeCodeIsAuthenticated} />

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
