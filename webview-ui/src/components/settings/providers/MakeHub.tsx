import { useCallback, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import type { ProviderSettings, OrganizationAllowList } from "@roo-code/types"
import { makehubDefaultModelId } from "@roo-code/types"
import type { RouterModels } from "@roo/api"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Button, Slider } from "@src/components/ui"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type MakeHubProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const MakeHub = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	organizationAllowList,
	modelValidationError,
}: MakeHubProps) => {
	const { t } = useAppTranslation()
	const [didRefetch, setDidRefetch] = useState<boolean>(false)

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

	const perfRatio = apiConfiguration?.makehubPerfRatio ?? 0.5

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.makehubApiKey || ""}
				type="password"
				onInput={handleInputChange("makehubApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.makehubApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			{!apiConfiguration?.makehubApiKey && (
				<VSCodeButtonLink href="https://makehub.ai/api-keys" style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getMakehubApiKey")}
				</VSCodeButtonLink>
			)}

			<div className="w-full space-y-2">
				<label className="block font-medium mb-1">{t("settings:providers.makehubPerfRatio")}</label>
				<Slider
					value={[perfRatio * 100]}
					onValueChange={(values: number[]) => {
						setApiConfigurationField("makehubPerfRatio", values[0] / 100)
					}}
					min={0}
					max={100}
					step={5}
					className="w-full"
				/>
				<div className="flex justify-between text-sm text-vscode-descriptionForeground">
					<span>{t("settings:providers.makehubPerfRatioLabels.price")}</span>
					<span>{t("settings:providers.makehubPerfRatioLabels.balanced")}</span>
					<span>{t("settings:providers.makehubPerfRatioLabels.performance")}</span>
				</div>
				<div className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:providers.makehubPerfRatioDescription")}
				</div>
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={makehubDefaultModelId}
				models={routerModels?.makehub ?? {}}
				modelIdKey="makehubModelId"
				serviceName="MakeHub"
				serviceUrl="https://makehub.ai/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>

			<Button
				variant="outline"
				onClick={() => {
					vscode.postMessage({ type: "flushRouterModels", text: "makehub" })
					vscode.postMessage({ type: "requestRouterModels" })
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
		</>
	)
}
