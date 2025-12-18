import { type ProviderSettings, type OrganizationAllowList, rooDefaultModelId } from "@roo-code/types"

import type { RouterModels } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

import { ModelPicker } from "../ModelPicker"

type RooProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	cloudIsAuthenticated: boolean
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	simplifySettings?: boolean
}

export const Roo = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	cloudIsAuthenticated,
	organizationAllowList,
	modelValidationError,
	simplifySettings,
}: RooProps) => {
	const { t } = useAppTranslation()

	return (
		<>
			{cloudIsAuthenticated ? (
				<div className="flex justify-between items-center mb-2">
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.roo.authenticatedMessage")}
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<Button
						variant="primary"
						onClick={() => vscode.postMessage({ type: "rooCloudSignIn" })}
						className="w-fit">
						{t("settings:providers.roo.connectButton")}
					</Button>
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
				simplifySettings={simplifySettings}
			/>
		</>
	)
}
