import { getOpenRouterAuthUrl } from "@/oauth/urls"
import { t } from "i18next"
import { VSCodeButtonLink } from "../common/VSCodeButtonLink"

export const KiloCodeFreeModelLink = (props: { uriScheme?: string; isOpenRouterKeySet: boolean }) => {
	return (
		<div className="bg-vscode-editor-background border p-3 shadow-sm text-center">
			<div className="text-vscode-descriptionForeground">
				This free model has a higher rate limit with a personal OpenRouter account!
			</div>
			{!props.isOpenRouterKeySet && (
				<VSCodeButtonLink
					href={getOpenRouterAuthUrl(props.uriScheme)}
					appearance="primary"
					className="mt-3 w-full">
					{t("settings:providers.getOpenRouterApiKey")}
				</VSCodeButtonLink>
			)}
		</div>
	)
}
