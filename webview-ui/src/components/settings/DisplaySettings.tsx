// kilocode_change - new file
import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Monitor } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { TaskTimeline } from "../chat/TaskTimeline"
import { generateSampleTimelineData } from "../../utils/timeline/mockData"
import { Slider } from "../ui"

type DisplaySettingsProps = HTMLAttributes<HTMLDivElement> & {
	showTaskTimeline?: boolean
	hideCostBelowThreshold?: number
	setCachedStateField: SetCachedStateField<"showTaskTimeline" | "hideCostBelowThreshold">
}

export const DisplaySettings = ({
	showTaskTimeline,
	hideCostBelowThreshold,
	setCachedStateField,
	...props
}: DisplaySettingsProps) => {
	const { t } = useAppTranslation()

	const sampleTimelineData = useMemo(() => generateSampleTimelineData(), [])

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Monitor className="w-4" />
					<div>{t("settings:sections.display")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={showTaskTimeline}
						onChange={(e: any) => {
							setCachedStateField("showTaskTimeline", e.target.checked)
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
