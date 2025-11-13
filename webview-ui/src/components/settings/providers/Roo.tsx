import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type OrganizationAllowList, rooDefaultModelId } from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

import { ModelPicker } from "../ModelPicker"

type RooProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	cloudIsAuthenticated: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const Roo = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	cloudIsAuthenticated,
	organizationAllowList,
	modelValidationError,
}: RooProps) => {
	const { t } = useAppTranslation()

	return (
		<>
			{cloudIsAuthenticated ? (
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.roo.authenticatedMessage")}
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<VSCodeButton
						appearance="primary"
						onClick={() => vscode.postMessage({ type: "rooCloudSignIn" })}
						className="w-fit">
						{t("settings:providers.roo.connectButton")}
					</VSCodeButton>
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={rooDefaultModelId}
				models={routerModels?.roo ?? {}}
				modelIdKey="apiModelId"
				serviceName="Roo Code Cloud"
				serviceUrl="https://roocode.com"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}
