import { useCallback, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type OrganizationAllowList, tarsDefaultModelId } from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Button } from "@src/components/ui"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type TarsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	refetchRouterModels: () => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Tars = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	refetchRouterModels,
	organizationAllowList,
	modelValidationError,
}: TarsProps) => {
	const { t } = useAppTranslation()

	const [didRefetch, setDidRefetch] = useState<boolean>()

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
				value={apiConfiguration?.tarsApiKey || ""}
				type="password"
				onInput={handleInputChange("tarsApiKey")}
				placeholder={t("settings:providers.getTarsApiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("settings:providers.tarsApiKey")}</label>
				</div>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.tarsApiKey && (
				<VSCodeButtonLink href="https://router.tetrate.ai" style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getTarsApiKey")}
				</VSCodeButtonLink>
			)}
			<Button
				variant="outline"
				onClick={() => {
					vscode.postMessage({ type: "flushRouterModels", text: "tars" })
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
				defaultModelId={tarsDefaultModelId}
				models={routerModels?.tars ?? {}}
				modelIdKey="tarsModelId"
				serviceName="Tetrate Agent Router Service"
				serviceUrl="https://tetrate.io/products/tetrate-agent-router-service"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}
