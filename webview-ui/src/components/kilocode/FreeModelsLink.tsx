import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { TelemetryEventName } from "@roo-code/types"

export const FreeModelsLink = ({
	className,
	origin,
	modelId,
}: {
	className: string
	origin: "chat" | "settings" | "invalid_model"
	modelId?: string
}) => {
	const { t } = useAppTranslation()
	return (
		<VSCodeButtonLink
			href="https://kilo.love/continueforfree"
			appearance="primary"
			className={className}
			onClick={() => {
				telemetryClient.capture(TelemetryEventName.FREE_MODELS_LINK_CLICKED, {
					modelId,
					origin,
				})
			}}>
			{t("kilocode:pricing.freeModelsLink")}
		</VSCodeButtonLink>
	)
}
