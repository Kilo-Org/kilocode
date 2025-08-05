import { getOpenRouterAuthUrl } from "@/oauth/urls"
import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"

export const KiloCodeFreeModelLink = ({ modelId, uriScheme }: { modelId: string; uriScheme?: string }) => {
	const { t } = useAppTranslation()
	const href = getOpenRouterAuthUrl(uriScheme)
	return (
		<div className="bg-vscode-editor-background border p-3 shadow-sm text-center">
			<div className="text-vscode-descriptionForeground">{t("kilocode:settings.provider.freeModelLink")}</div>
			<VSCodeButtonLink
				href={getOpenRouterAuthUrl(uriScheme)}
				appearance="primary"
				className="mt-3 w-full"
				onClick={() => {
					telemetryClient.capture(TelemetryEventName.OPENROUTER_FREE_MODEL_LINK_CLICKED, {
						modelId,
						href,
					})
				}}>
				{t("settings:providers.getOpenRouterApiKey")}
			</VSCodeButtonLink>
		</div>
	)
}
