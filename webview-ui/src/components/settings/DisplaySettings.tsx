// kilocode_change - new file
import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Monitor } from "lucide-react"
import { telemetryClient } from "@/utils/TelemetryClient"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { TaskTimeline } from "../chat/TaskTimeline"
import { generateSampleTimelineData } from "../../utils/timeline/mockData"
import { Slider } from "../ui"

type DisplaySettingsProps = HTMLAttributes<HTMLDivElement> & {
	showTaskTimeline?: boolean
	sendMessageOnEnter?: boolean // kilocode_change
	showTimestamps?: boolean
	showDiffStats?: boolean // kilocode_change
	reasoningBlockCollapsed: boolean
	setCachedStateField: SetCachedStateField<
		| "showTaskTimeline"
		| "sendMessageOnEnter"
		| "ghostServiceSettings"
		| "reasoningBlockCollapsed"
		| "hideCostBelowThreshold"
		| "showTimestamps"
		| "showDiffStats"
	>
	hideCostBelowThreshold?: number
}

export const DisplaySettings = ({
	showTaskTimeline,
	showTimestamps,
	showDiffStats,
	sendMessageOnEnter,
	setCachedStateField,
	reasoningBlockCollapsed,
	hideCostBelowThreshold,
	...props
}: DisplaySettingsProps) => {
	const { t } = useAppTranslation()

	const sampleTimelineData = useMemo(() => generateSampleTimelineData(), [])

	const handleReasoningBlockCollapsedChange = (value: boolean) => {
		setCachedStateField("reasoningBlockCollapsed", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_collapse_thinking_changed", {
			enabled: value,
		})
	}

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Monitor className="w-4" />
					<div>{t("settings:sections.display")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div className="flex flex-col gap-1">
					<VSCodeCheckbox
						checked={reasoningBlockCollapsed}
						onChange={(e: any) => handleReasoningBlockCollapsedChange(e.target.checked)}
						data-testid="collapse-thinking-checkbox">
						<span className="font-medium">{t("settings:ui.collapseThinking.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
						{t("settings:ui.collapseThinking.description")}
					</div>
				</div>
				<div>
					<VSCodeCheckbox
						checked={showTaskTimeline}
						onChange={(e) => {
							setCachedStateField("showTaskTimeline", (e as any).target?.checked || false)
						}}>
						<span className="font-medium">{t("settings:display.taskTimeline.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:display.taskTimeline.description")}
					</div>

					{/* Sample TaskTimeline preview */}
					<div className="mt-3">
						<div className="font-medium text-vscode-foreground text-xs mb-4">Preview</div>
						<div className="opacity-60">
							<TaskTimeline groupedMessages={sampleTimelineData} isTaskActive={false} />
						</div>
					</div>
				</div>
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
				{/* Show Diff Stats checkbox */}
				<div className="mt-3">
					<VSCodeCheckbox
						checked={showDiffStats}
						onChange={(e: any) => {
							setCachedStateField("showDiffStats", e.target.checked)
						}}>
						<span className="font-medium">{t("settings:display.showDiffStats.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:display.showDiffStats.description")}
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

			<Section>
				<div>
					<div className="font-medium">{t("settings:display.costThreshold.label")}</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:display.costThreshold.description")}
					</div>

					<div className="mt-3">
						<div className="flex items-center gap-2">
							<Slider
								min={0}
								max={1}
								step={0.01}
								value={[hideCostBelowThreshold ?? 0]}
								onValueChange={([value]) => setCachedStateField("hideCostBelowThreshold", value)}
								data-testid="cost-threshold-slider"
								className="flex-1"
							/>
							<span className="text-sm text-vscode-foreground min-w-[60px]">
								${(hideCostBelowThreshold ?? 0).toFixed(2)}
							</span>
						</div>
						<div className="text-xs text-vscode-descriptionForeground mt-1">
							{t("settings:display.costThreshold.currentValue", {
								value: (hideCostBelowThreshold ?? 0).toFixed(2),
							})}
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
