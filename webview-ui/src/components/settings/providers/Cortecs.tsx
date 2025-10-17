import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	cortecsDefaultModelId,
	ROUTING_PREFERENCES,
} from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"

type CortecsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	fromWelcomeView?: boolean
	refetchRouterModels: () => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Cortecs = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	fromWelcomeView,
	refetchRouterModels,
	organizationAllowList,
	modelValidationError,
}: CortecsProps) => {
	const { t } = useAppTranslation()

	const [didRefetch, setDidRefetch] = useState<boolean>()
	const [cortecsBaseUrlSelected, setCortecsBaseUrlSelected] = useState(!!apiConfiguration?.cortecsBaseUrl)

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
		<>
			<VSCodeTextField
				value={apiConfiguration?.cortecsApiKey || ""}
				type="password"
				onInput={handleInputChange("cortecsApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium">{t("settings:providers.cortecsApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.cortecsApiKey && (
				<VSCodeButtonLink
					href="https://docs.cortecs.ai/quickstart"
					style={{ width: "100%" }}
					appearance="primary">
					{t("settings:providers.getCortecsApiKey")}
				</VSCodeButtonLink>
			)}
			{!fromWelcomeView && (
				<>
					<div>
						<Checkbox
							checked={cortecsBaseUrlSelected}
							onChange={(checked: boolean) => {
								setCortecsBaseUrlSelected(checked)

								if (!checked) {
									setApiConfigurationField("cortecsBaseUrl", "")
								}
							}}>
							{t("settings:providers.useCustomBaseUrl")}
						</Checkbox>
						{cortecsBaseUrlSelected && (
							<VSCodeTextField
								value={apiConfiguration?.cortecsBaseUrl || ""}
								type="url"
								onInput={handleInputChange("cortecsBaseUrl")}
								placeholder="Default: https://api.cortecs.ai/v1"
								className="w-full mt-1"
							/>
						)}
					</div>
				</>
			)}
			<div>
				<label className="block font-medium mb-1">
					{t("settings:providers.cortecsRoutingPreference.title")}
				</label>
				<Select
					value={apiConfiguration?.cortecsRoutingPreference || ""}
					onValueChange={(value) => setApiConfigurationField("cortecsRoutingPreference", value)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						{ROUTING_PREFERENCES.map(({ value, label }) => (
							<SelectItem key={value} value={value}>
								{t(label)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<Button
				variant="outline"
				onClick={() => {
					vscode.postMessage({ type: "flushRouterModels", text: "requesty" })
					refetchRouterModels()
					setDidRefetch(true)
				}}>
				<div className="flex items-center gap-2">
					<span className="codicon codicon-refresh" />
					{t("settings:providers.refreshModels.label")}
				</div>
			</Button>
			{didRefetch && (
				<div className="flex items-center text-vscode-errorForeground">
					{t("settings:providers.refreshModels.hint")}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={cortecsDefaultModelId}
				models={routerModels?.cortecs ?? {}}
				modelIdKey="cortecsModelId"
				serviceName="cortecs"
				serviceUrl="https://cortecs.ai/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}
