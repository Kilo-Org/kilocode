import { useCallback } from "react"
import { VSCodeTextField, VSCodeTextArea, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type TestingToolsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const TestingTools = ({ apiConfiguration, setApiConfigurationField }: TestingToolsProps) => {
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

	const toolsJsonPlaceholder = JSON.stringify(
		[
			{
				type: "function",
				function: {
					name: "example_tool",
					description: "An example tool",
					parameters: {
						type: "object",
						properties: {
							param: {
								type: "string",
								description: "Example parameter",
							},
						},
						required: ["param"],
					},
				},
			},
		],
		null,
		2,
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.testingToolsApiKey || ""}
				type="password"
				onInput={handleInputChange("testingToolsApiKey")}
				placeholder="Enter API key (e.g., XAI key)"
				className="w-full">
				<label className="block font-medium mb-1">API Key</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			<VSCodeTextField
				value={apiConfiguration?.testingToolsBaseUrl || ""}
				onInput={handleInputChange("testingToolsBaseUrl")}
				placeholder="https://api.x.ai/v1"
				className="w-full">
				<label className="block font-medium mb-1">Base URL</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				OpenAI-compatible API endpoint. Defaults to XAI if not specified.
			</div>

			<VSCodeTextField
				value={apiConfiguration?.testingToolsModelSlug || ""}
				onInput={handleInputChange("testingToolsModelSlug")}
				placeholder="grok-beta"
				className="w-full">
				<label className="block font-medium mb-1">Model Slug</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				Model identifier to use in API requests (e.g., grok-beta, gpt-4, claude-3-5-sonnet).
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<VSCodeTextField
						value={apiConfiguration?.testingToolsContextWindow?.toString() || ""}
						onInput={handleInputChange("testingToolsContextWindow", (e: any) => {
							const val = parseInt(e.target.value)
							return isNaN(val) ? undefined : val
						})}
						placeholder="128000"
						className="w-full">
						<label className="block font-medium mb-1">Context Window</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">Maximum context tokens</div>
				</div>
				<div>
					<VSCodeTextField
						value={apiConfiguration?.testingToolsMaxTokens?.toString() || ""}
						onInput={handleInputChange("testingToolsMaxTokens", (e: any) => {
							const val = parseInt(e.target.value)
							return isNaN(val) ? undefined : val
						})}
						placeholder="16384"
						className="w-full">
						<label className="block font-medium mb-1">Max Tokens</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">Maximum output tokens</div>
				</div>
			</div>

			{!apiConfiguration?.testingToolsApiKey && (
				<VSCodeButtonLink href="https://console.x.ai" appearance="secondary">
					Get XAI API Key
				</VSCodeButtonLink>
			)}

			<div className="border-t border-vscode-panel-border pt-3 mt-2">
				<h3 className="font-medium mb-3">Testing Configuration</h3>

				<VSCodeCheckbox
					checked={apiConfiguration?.testingToolsUseFullSystemPrompt ?? false}
					onChange={handleInputChange("testingToolsUseFullSystemPrompt", (e: any) => e.target.checked)}>
					Use Full System Prompt (without XML tools)
				</VSCodeCheckbox>
				<div className="text-sm text-vscode-descriptionForeground mb-3">
					When enabled, generates the full system prompt (with environment details, capabilities, rules, etc.)
					but without XML tool definitions. When disabled, uses the override below if provided.
				</div>

				<VSCodeTextArea
					value={apiConfiguration?.testingToolsSystemPromptOverride || ""}
					onInput={handleInputChange("testingToolsSystemPromptOverride")}
					rows={10}
					placeholder="Leave empty to use default system prompt"
					className="w-full"
					disabled={apiConfiguration?.testingToolsUseFullSystemPrompt ?? false}>
					<label className="block font-medium mb-1">System Prompt Override</label>
				</VSCodeTextArea>
				<div className="text-sm text-vscode-descriptionForeground -mt-2 mb-3">
					Override the system prompt for all requests. Leave empty to use the default mode prompt. Disabled
					when "Use Full System Prompt" is enabled.
				</div>

				<VSCodeTextArea
					value={apiConfiguration?.testingToolsToolsJson || ""}
					onInput={handleInputChange("testingToolsToolsJson")}
					rows={15}
					placeholder={toolsJsonPlaceholder}
					className="w-full font-mono text-xs">
					<label className="block font-medium mb-1">Tools JSON (OpenAI Format)</label>
				</VSCodeTextArea>
				<div className="text-sm text-vscode-descriptionForeground -mt-2">
					Provide tools in OpenAI format. Must be valid JSON array of tool definitions.
				</div>
			</div>
		</>
	)
}
