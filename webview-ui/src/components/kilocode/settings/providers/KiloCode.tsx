import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { getKiloCodeBackendSignInUrl } from "../../helpers"
import { Button } from "@src/components/ui"
import { ExternalLinkIcon } from "@radix-ui/react-icons"
import { type ProviderSettings, type OrganizationAllowList } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { inputEventTransform } from "../../../settings/transforms"
import { ModelPicker } from "../../../settings/ModelPicker"
import { vscode } from "@src/utils/vscode"

type KiloCodeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	currentApiConfigName?: string
	hideKiloCodeButton?: boolean
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	uriScheme: string | undefined
	uiKind: string | undefined
}

export const KiloCode = ({
	apiConfiguration,
	setApiConfigurationField,
	currentApiConfigName,
	hideKiloCodeButton,
	routerModels,
	organizationAllowList,
	uriScheme,
	uiKind,
}: KiloCodeProps) => {
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

	const { data: openRouterModelProviders } = useOpenRouterModelProviders(
		apiConfiguration?.kilocodeModel,
		undefined,
		undefined,
		{
			enabled:
				!!apiConfiguration?.kilocodeModel &&
				routerModels?.openrouter &&
				Object.keys(routerModels.openrouter).length > 1 &&
				apiConfiguration.kilocodeModel in routerModels.openrouter,
		},
	)

	return (
		<>
			<div style={{ marginTop: "0px" }} className="text-sm text-vscode-descriptionForeground -mt-2">
				You get $20 for free!
			</div>
			<div>
				<label className="block font-medium -mb-2">{t("kilocode:settings.provider.account")}</label>
			</div>
			{!hideKiloCodeButton &&
				(apiConfiguration.kilocodeToken ? (
					<div>
						<Button
							variant="secondary"
							onClick={async () => {
								setApiConfigurationField("kilocodeToken", "")

								vscode.postMessage({
									type: "upsertApiConfiguration",
									text: currentApiConfigName,
									apiConfiguration: {
										...apiConfiguration,
										kilocodeToken: "",
									},
								})
							}}>
							{t("kilocode:settings.provider.logout")}
						</Button>
					</div>
				) : (
					<VSCodeButtonLink variant="secondary" href={getKiloCodeBackendSignInUrl(uriScheme, uiKind)}>
						{t("kilocode:settings.provider.login")}
					</VSCodeButtonLink>
				))}

			<VSCodeTextField
				value={apiConfiguration?.kilocodeToken || ""}
				type="password"
				onInput={handleInputChange("kilocodeToken")}
				placeholder={t("kilocode:settings.provider.apiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("kilocode:settings.provider.apiKey")}</label>
				</div>
			</VSCodeTextField>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId="claude37"
				models={routerModels?.["kilocode-openrouter"] ?? {}}
				modelIdKey="kilocodeModel"
				serviceName="Kilo Code"
				serviceUrl="https://kilocode.ai"
				organizationAllowList={organizationAllowList}
			/>

			{openRouterModelProviders && Object.keys(openRouterModelProviders).length > 0 && (
				<div>
					<div className="flex items-center gap-1">
						<label className="block font-medium mb-1">
							{t("kilocode:settings.provider.providerRouting.title")}
						</label>
						<a href={`https://openrouter.ai/${apiConfiguration?.kilocodeModel}/providers`}>
							<ExternalLinkIcon className="w-4 h-4" />
						</a>
					</div>
					<Select
						value={apiConfiguration?.openRouterSpecificProvider || OPENROUTER_DEFAULT_PROVIDER_NAME}
						onValueChange={(value) => setApiConfigurationField("openRouterSpecificProvider", value)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
								{OPENROUTER_DEFAULT_PROVIDER_NAME}
							</SelectItem>
							{Object.entries(openRouterModelProviders).map(([value, { label }]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{t("kilocode:settings.provider.providerRouting.description")}
					</div>
				</div>
			)}
		</>
	)
}
