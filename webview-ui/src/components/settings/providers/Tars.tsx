import { useCallback, useState, useEffect } from "react"
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type OrganizationAllowList, tarsDefaultModelId } from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { getTarsAuthUrl } from "@src/oauth/urls"
import { generatePKCEPair } from "@src/oauth/pkce"
import { vscode } from "@src/utils/vscode"

import { inputEventTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"

type TarsProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	selectedModelId: string
	uriScheme: string | undefined
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Tars = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	uriScheme,
	organizationAllowList,
	modelValidationError,
}: TarsProps) => {
	const { t } = useAppTranslation()

	const [authUrl, setAuthUrl] = useState<string>("")

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

	// Generate PKCE pair when component mounts
	useEffect(() => {
		const initPKCE = async () => {
			const { verifier, challenge } = await generatePKCEPair()
			setAuthUrl(getTarsAuthUrl(challenge, uriScheme))
			// Store verifier for later use in callback (extension will handle storage)
			vscode.postMessage({
				type: "storeTarsPKCEVerifier",
				verifier,
			})
		}
		initPKCE()
	}, [uriScheme])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.tarsApiKey || ""}
				type="password"
				onInput={handleInputChange("tarsApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.tarsApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.tarsApiKey && authUrl && (
				<a href={authUrl} target="_blank" rel="noopener noreferrer" style={{ width: "100%", display: "block" }}>
					<VSCodeButton style={{ width: "100%" }} appearance="primary">
						{t("settings:providers.getTarsApiKey")}
					</VSCodeButton>
				</a>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={tarsDefaultModelId}
				models={routerModels?.tars ?? {}}
				modelIdKey="tarsModelId"
				serviceName="TARS"
				serviceUrl="https://tars.tetrate.ai/models"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}
