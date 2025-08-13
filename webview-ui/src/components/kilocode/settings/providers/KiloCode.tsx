import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { getKiloCodeBackendSignInUrl } from "../../helpers"
import { Button } from "@src/components/ui"
import { type ProviderSettings, type OrganizationAllowList, kilocodeDefaultModelId } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
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

	return (
		<>
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
				defaultModelId={kilocodeDefaultModelId}
				models={routerModels?.["kilocode-openrouter"] ?? {}}
				modelIdKey="kilocodeModel"
				serviceName="Kilo Code"
				serviceUrl="https://kilocode.ai"
				organizationAllowList={organizationAllowList}
			/>
		</>
	)
}
