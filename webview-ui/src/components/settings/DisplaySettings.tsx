// kilocode_change - new file
import { HTMLAttributes, useMemo, useState } from "react"
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
	ghostServiceSettings?: any
	reasoningBlockCollapsed: boolean
	setCachedStateField: SetCachedStateField<
		"showTaskTimeline" | "ghostServiceSettings" | "reasoningBlockCollapsed" | "hideCostBelowThreshold"
	>
	hideCostBelowThreshold?: number
}

export const DisplaySettings = ({
	showTaskTimeline,
	ghostServiceSettings,
	setCachedStateField,
	reasoningBlockCollapsed,
	hideCostBelowThreshold,
	...props
}: DisplaySettingsProps) => {
	const { t } = useAppTranslation()

	// Get the icons base URI for the animated logo
	const [iconsBaseUri] = useState(() => {
		const w = window as any
		return w.ICONS_BASE_URI || ""
	})

	const sampleTimelineData = useMemo(() => generateSampleTimelineData(), [])

	const onShowGutterAnimationChange = (newValue: boolean) => {
		setCachedStateField("ghostServiceSettings", {
			...(ghostServiceSettings || {}),
			showGutterAnimation: newValue,
		})
	}

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

				{/* Gutter Animation Setting */}
				<div className="mt-6 pt-6 border-t border-vscode-panel-border">
					<div className="flex flex-col gap-1">
						<VSCodeCheckbox
							checked={ghostServiceSettings?.showGutterAnimation !== false}
							onChange={(e) => {
								onShowGutterAnimationChange((e as any).target?.checked || false)
							}}>
							<span className="font-medium">{t("settings:ghost.showGutterAnimation.label")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:ghost.showGutterAnimation.description")}
						</div>
						<div className="mt-3 flex items-center gap-3">
							<div className="flex items-center justify-center w-10 h-10 bg-vscode-editor-background border border-vscode-panel-border rounded">
								<img
									src={`${iconsBaseUri}/logo-outline-yellow.gif`}
									alt="Animated logo"
									className="w-8 h-8"
								/>
							</div>
							<span className="text-vscode-descriptionForeground text-xs">
								{t("settings:ghost.showGutterAnimation.preview")}
							</span>
						</div>
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
