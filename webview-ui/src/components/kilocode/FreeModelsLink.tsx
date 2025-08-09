import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { TelemetryEventName } from "@roo-code/types"

export const FreeModelsInfoView = ({ origin, modelId }: { origin: "chat" | "settings"; modelId?: string }) => {
	const { t } = useAppTranslation()
	return (
		<div className="bg-vscode-editor-background border p-3 shadow-sm text-center">
			<div className="text-vscode-descriptionForeground">{t("kilocode:pricing.freeModelsDescription")}</div>
			<FreeModelsLink className="mt-3 w-full" origin={origin} modelId={modelId} />
		</div>
	)
}

export const FreeModelsLink = ({
	className,
	origin,
	modelId,
}: {
	className: string
	origin: "chat" | "settings"
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
