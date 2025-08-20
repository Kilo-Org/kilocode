import { useCallback, useState, useMemo } from "react"
import { Trans } from "react-i18next"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	cometApiModels,
	cometApiDefaultModelId,
} from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { inputEventTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"

type CometAPIProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	selectedModelId: string
	_uriScheme: string | undefined
	fromWelcomeView?: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const CometAPI = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels: _routerModels,
	_uriScheme,
	fromWelcomeView,
	organizationAllowList,
	modelValidationError,
}: CometAPIProps) => {
	const { t } = useAppTranslation()

	const [cometApiBaseUrlSelected, setCometApiBaseUrlSelected] = useState(!!apiConfiguration?.cometApiBaseUrl)

	// Get dynamic models from router with API key and base URL as query dependencies
	const routerModels = useRouterModels({
		cometApiKey: apiConfiguration?.cometApiKey,
		cometApiBaseUrl: apiConfiguration?.cometApiBaseUrl,
	})

	// Use dynamic models if available, otherwise fall back to static models
	const availableModels = useMemo(() => {
		const dynamicModels = routerModels.data?.cometapi
		if (dynamicModels && Object.keys(dynamicModels).length > 0) {
			// Convert RouterModels format to ModelRecord format for ModelPicker
			const modelRecord: Record<string, any> = {}
			for (const [modelId, modelInfo] of Object.entries(dynamicModels)) {
				modelRecord[modelId] = modelInfo
			}
			return modelRecord
		}
		// Fall back to static models
		return cometApiModels
	}, [routerModels.data])

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

	return (
		<div className="flex flex-col gap-4">
			{!fromWelcomeView && (
				<p className="text-xs text-vscode-descriptionForeground">
					<Trans
						i18nKey="settings:providers.cometapi.description"
						defaults="Access 500+ models through CometAPI's unified interface. Get your API key from https://api.cometapi.com/console/token"
						components={{
							link: <VSCodeLink href="https://cometapi.com">cometapi.com</VSCodeLink>,
						}}
					/>
				</p>
			)}

			<VSCodeTextField
				value={apiConfiguration?.cometApiKey || ""}
				type="password"
				onChange={handleInputChange("cometApiKey")}
				placeholder="sk-..."
				className="w-full">
				<label
					className="block font-medium mb-1"
					title="Get your API key from https://api.cometapi.com/console/token">
					CometAPI Key
				</label>
			</VSCodeTextField>

			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			{!fromWelcomeView && (
				<div>
					<Checkbox
						checked={cometApiBaseUrlSelected}
						onChange={(checked: boolean) => {
							setCometApiBaseUrlSelected(checked)
							if (!checked) {
								setApiConfigurationField("cometApiBaseUrl", undefined)
							}
						}}>
						{t("settings:providers.useCustomBaseUrl")}
					</Checkbox>

					{cometApiBaseUrlSelected && (
						<VSCodeTextField
							value={apiConfiguration?.cometApiBaseUrl || ""}
							type="url"
							onChange={handleInputChange("cometApiBaseUrl")}
							placeholder="https://api.cometapi.com/v1"
							className="w-full mt-1"
						/>
					)}
				</div>
			)}

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={cometApiDefaultModelId}
				models={availableModels}
				modelIdKey="cometApiModelId"
				serviceName="CometAPI"
				serviceUrl="https://cometapi.com/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>

			{!fromWelcomeView && (
				<div className="text-xs text-vscode-descriptionForeground">
					<p className="mb-2">
						{t("settings:providers.cometapi.note", {
							defaultValue:
								"CometAPI provides access to multiple AI models including Claude, GPT, and more through a unified API.",
						})}
					</p>
					<p>
						<Trans
							i18nKey="settings:providers.cometapi.documentation"
							defaults="See <link>CometAPI documentation</link> for supported models and pricing."
							components={{
								link: (
									<VSCodeLink href="https://api.cometapi.com/doc">CometAPI documentation</VSCodeLink>
								),
							}}
						/>
					</p>
				</div>
			)}
		</div>
	)
}
