import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getAppUrl } from "@roo-code/types"

export function OrganizationModeWarning() {
	const { t } = useAppTranslation()
	const { apiConfiguration } = useExtensionState()
	const organizationId = apiConfiguration?.kilocodeOrganizationId

	return (
		<div className="mb-4 p-3 border border-vscode-inputValidation-infoBorder rounded">
			<div className="flex items-start gap-2">
				<span className="codicon codicon-organization mt-0.5"></span>
				<div className="text-sm ">
					<div className="font-semibold mb-1">{t("prompts:organizationMode.title")}</div>
					<div>
						<Trans
							i18nKey="prompts:organizationMode.description"
							components={{
								dashboardLink: (
									<VSCodeLink
										href={getAppUrl(`/organizations/${organizationId}/custom-modes`)}
										style={{ display: "inline" }}
									/>
								),
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	)
}
