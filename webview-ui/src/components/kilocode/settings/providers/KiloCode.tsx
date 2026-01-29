import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Button } from "@src/components/ui"
import { type ProviderSettings, type OrganizationAllowList } from "@roo-code/types"
import type { RouterModels } from "@roo/api"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { inputEventTransform } from "../../../settings/transforms"
import { ModelPicker } from "../../../settings/ModelPicker"
import { vscode } from "@src/utils/vscode"
import { OrganizationSelector } from "../../common/OrganizationSelector"
import { getAppUrl } from "@roo-code/types"
import { useKiloIdentity } from "@src/utils/kilocode/useKiloIdentity"

type KiloCodeProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	currentApiConfigName?: string
	hideKiloCodeButton?: boolean
	routerModels?: RouterModels
	organizationAllowList: OrganizationAllowList
	kilocodeDefaultModel: string
}

export const KiloCode = ({
	apiConfiguration,
	setApiConfigurationField,
	currentApiConfigName,
	hideKiloCodeButton,
	routerModels,
	organizationAllowList,
	kilocodeDefaultModel,
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

	// Use the existing hook to get user identity
	const userIdentity = useKiloIdentity(apiConfiguration.kilocodeToken || "", "")
	const isKiloCodeAiUser = userIdentity.endsWith("@kilo.ai")

	const areKilocodeWarningsDisabled = apiConfiguration.kilocodeTesterWarningsDisabledUntil
		? apiConfiguration.kilocodeTesterWarningsDisabledUntil > Date.now()
		: false

	const handleToggleTesterWarnings = useCallback(() => {
		const newTimestamp = Date.now() + (areKilocodeWarningsDisabled ? 0 : 24 * 60 * 60 * 1000)
		setApiConfigurationField("kilocodeTesterWarningsDisabledUntil", newTimestamp)
	}, [areKilocodeWarningsDisabled, setApiConfigurationField])

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
										kilocodeOrganizationId: undefined,
									},
								})
							}}>
							{t("kilocode:settings.provider.logout")}
						</Button>
					</div>
				) : (
					<>
						<div className="flex flex-row items-center gap-1 text-vscode-charts-green text-sm">
							<div className="codicon codicon-info" />
							<div>{t("kilocode:settings.provider.loginForPremiumModels")}</div>
						</div>
						<Button
							variant="secondary"
							onClick={() => {
								vscode.postMessage({
									type: "switchTab",
									tab: "auth",
									values: { returnTo: "settings", profileName: currentApiConfigName },
								})
							}}>
							{t("kilocode:settings.provider.login")}
						</Button>
					</>
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

			<OrganizationSelector showLabel />

			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={kilocodeDefaultModel}
				models={routerModels?.kilocode ?? {}}
				modelIdKey="kilocodeModel"
				serviceName="Kilo Code"
				serviceUrl={getAppUrl()}
				organizationAllowList={organizationAllowList}
			/>

			{/* KILOCODE-TESTER warnings setting - only visible for @kilo.ai users */}
			{isKiloCodeAiUser && (
				<div className="mb-4">
					<label className="block font-medium mb-2">Disable KILOCODE-TESTER warnings</label>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{areKilocodeWarningsDisabled
							? `Warnings disabled until ${new Date(apiConfiguration.kilocodeTesterWarningsDisabledUntil || 0).toLocaleString()}`
							: "KILOCODE-TESTER warnings are currently enabled"}
					</div>
					<Button variant="secondary" onClick={handleToggleTesterWarnings} className="text-sm">
						{areKilocodeWarningsDisabled ? "Enable warnings now" : "Disable warnings for 1 day"}
					</Button>
				</div>
			)}
		</>
	)
}
