import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { TelemetryEventName } from "@roo-code/types"

const WarningBox = ({ children }: { children: React.ReactNode }) => {
	return (
		<div className="bg-vscode-editor-background text-vscode-descriptionForeground border p-3 text-center">
			{children}
		</div>
	)
}

export const FreeModelsInfoView = ({ origin, modelId }: { origin: "chat" | "settings"; modelId?: string }) => {
	const { t } = useAppTranslation()
	return (
		<WarningBox>
			<div>{t("kilocode:pricing.freeModelsDescription")}</div>
			<FreeModelsLink className="mt-3 w-full" origin={origin} modelId={modelId} />
		</WarningBox>
	)
}

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
