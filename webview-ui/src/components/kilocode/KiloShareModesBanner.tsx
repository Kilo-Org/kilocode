// kilocode_change - new file
import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { getAppUrl, TelemetryEventName } from "@roo-code/types"
import { telemetryClient } from "@/utils/TelemetryClient"

interface KiloShareModesBannerProps {
	className?: string
}

export const KiloShareModesBanner: React.FC<KiloShareModesBannerProps> = ({ className = "" }) => {
	const { t } = useAppTranslation()

	return (
		<a
			className={`flex items-center gap-1 bg-vscode-editor-background border border-vscode-panel-border rounded-md p-1 my-1 mb-2 text-[var(--vscode-activityWarningBadge-background)] cursor-pointer hover:[filter:brightness(1.1)] ${className}`}
			href={getAppUrl("/organizations/new")}
			onClick={() => {
				telemetryClient.capture(TelemetryEventName.CREATE_ORGANIZATION_LINK_CLICKED, {
					origin: "modes-view",
				})
			}}>
			<div className="flex items-center px-2 py-0.5 rounded-full text-xs font-bold">
				<span className="codicon codicon-sparkle text-xs" />
			</div>
			<span className="text-sm">
				<span className="font-bold">NEW:</span> {t("kilocode:modes.shareModesNewBanner").replace("New: ", "")}
			</span>
		</a>
	)
}
