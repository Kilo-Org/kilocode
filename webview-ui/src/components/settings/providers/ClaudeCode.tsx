import { useTranslation } from "react-i18next"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { type ProviderSettings } from "@roo/shared/api"

interface ClaudeCodeProps {
	apiConfiguration?: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export default function ClaudeCode({ apiConfiguration, setApiConfigurationField }: ClaudeCodeProps) {
	const { t } = useTranslation()

	const handleInputChange =
		(field: keyof ProviderSettings) => (e: Event | React.FormEvent<HTMLElement>) => {
			const value = (e as any).target?.value
			setApiConfigurationField(field, value)
		}

	const handleNumberInputChange =
		(field: keyof ProviderSettings) => (e: Event | React.FormEvent<HTMLElement>) => {
			const value = (e as any).target?.value
			const numValue = value ? parseInt(value) : undefined
			setApiConfigurationField(field, numValue)
		}

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.claudeCodePath || ""}
				onInput={handleInputChange("claudeCodePath")}
				placeholder={t("settings:placeholders.claudeCodePath")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.claudeCodePath")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.claudeCodePathDescription")}
			</div>

			<VSCodeTextField
				value={apiConfiguration?.claudeCodeMaxOutputTokens?.toString() || ""}
				onInput={handleNumberInputChange("claudeCodeMaxOutputTokens")}
				placeholder={t("settings:placeholders.maxTokens")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.claudeCodeMaxOutputTokens")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.claudeCodeMaxOutputTokensDescription")}
			</div>
		</>
	)
}