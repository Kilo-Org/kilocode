// kilocode_change - new file
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Monitor } from "lucide-react"
import { HTMLAttributes } from "react"

import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"
import { SetCachedStateField } from "./types"

type DisplaySettingsProps = HTMLAttributes<HTMLDivElement> & {
	// showTaskTimeline?: boolean
	sendMessageOnEnter?: boolean // kilocode_change
	showTimestamps?: boolean
	ghostServiceSettings?: any
	// reasoningBlockCollapsed: boolean
	setCachedStateField: SetCachedStateField<
		// | "showTaskTimeline"
		| "sendMessageOnEnter"
		| "ghostServiceSettings"
		// | "reasoningBlockCollapsed"
		// | "hideCostBelowThreshold"
		| "showTimestamps"
	>
	// hideCostBelowThreshold?: number
}

export const DisplaySettings = ({
	// showTaskTimeline,
	showTimestamps,
	sendMessageOnEnter,
	ghostServiceSettings,
	setCachedStateField,
	// reasoningBlockCollapsed,
	// hideCostBelowThreshold,
	...props
}: DisplaySettingsProps) => {
	const { t } = useAppTranslation()

	// Get the icons base URI for the animated logo
	// const [iconsBaseUri] = useState(() => {
	// 	const w = window as any
	// 	return w.ICONS_BASE_URI || ""
	// })

	// const sampleTimelineData = useMemo(() => generateSampleTimelineData(), [])

	// const onShowGutterAnimationChange = (newValue: boolean) => {
	// 	setCachedStateField("ghostServiceSettings", {
	// 		...(ghostServiceSettings || {}),
	// 		showGutterAnimation: newValue,
	// 	})
	// }

	// const handleReasoningBlockCollapsedChange = (value: boolean) => {
	// 	setCachedStateField("reasoningBlockCollapsed", value)

	// 	// Track telemetry event
	// 	telemetryClient.capture("ui_settings_collapse_thinking_changed", {
	// 		enabled: value,
	// 	})
	// }

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Monitor className="w-4" />
					<div>{t("settings:sections.display")}</div>
				</div>
			</SectionHeader>

			<Section>
				{/* Show Timestamps checkbox */}
				<div className="mt-3">
					<VSCodeCheckbox
						checked={showTimestamps}
						onChange={(e: any) => {
							setCachedStateField("showTimestamps", e.target.checked)
						}}>
						<span className="font-medium">{t("settings:display.showTimestamps.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:display.showTimestamps.description")}
					</div>
				</div>
				{/* Send Message on Enter Setting */}
				<div className="flex flex-col gap-1">
					<VSCodeCheckbox
						checked={sendMessageOnEnter}
						onChange={(e) => {
							setCachedStateField("sendMessageOnEnter", (e as any).target?.checked || false)
						}}>
						<span className="font-medium">{t("settings:display.sendMessageOnEnter.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:display.sendMessageOnEnter.description")}
					</div>
				</div>
			</Section>
		</div>
	)
}
