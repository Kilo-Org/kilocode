import { getOpenRouterAuthUrl } from "@/oauth/urls"
import { t } from "i18next"
import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"
import { TelemetryEventName } from "@roo-code/types"

export const KiloCodeFreeModelLink = ({ modelId, uriScheme }: { modelId: string; uriScheme?: string }) => {
	const href = getOpenRouterAuthUrl(uriScheme)
	return (
		<div className="bg-vscode-editor-background border p-3 shadow-sm text-center">
			<div className="text-vscode-descriptionForeground">
				This free model has a higher rate limit with a personal OpenRouter account!
			</div>
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
