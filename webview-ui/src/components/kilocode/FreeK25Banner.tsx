// kilocode_change - new file
import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { TelemetryEventName } from "@roo-code/types"
import { telemetryClient } from "@/utils/TelemetryClient"
import { vscode } from "@/utils/vscode"

interface FreeK25BannerProps {
	className?: string
}

export const FreeK25Banner: React.FC<FreeK25BannerProps> = ({ className = "" }) => {
	const { t } = useAppTranslation()

	const handleClick = () => {
		telemetryClient.capture(TelemetryEventName.FREE_MODELS_LINK_CLICKED, {
			origin: "free-k25-banner",
		})
		vscode.postMessage({
			type: "openInBrowser",
			url: "https://kilo.love/freek25",
		})
	}

	return (
		<button
			onClick={handleClick}
			className={`flex items-center gap-1 bg-vscode-editor-background border border-vscode-panel-border rounded-md p-1 my-1 mb-2 text-[var(--vscode-charts-green)] cursor-pointer hover:[filter:brightness(1.1)] w-full text-left ${className}`}>
			<div className="flex items-center px-2 py-0.5 rounded-full text-xs font-bold">
				<span className="codicon codicon-gift text-xs" />
			</div>
			<span className="text-sm">
				<span className="font-bold">{t("kilocode:freeK25Banner.new")}</span>{" "}
				{t("kilocode:freeK25Banner.message")}
			</span>
		</button>
	)
}
