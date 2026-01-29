import { useState, useMemo } from "react"
import { telemetryClient } from "@/utils/TelemetryClient"
import { vscode } from "@/utils/vscode"
import { TelemetryEventName } from "@roo-code/types"
import { useTranslation } from "react-i18next"
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Lightbulb, Sparkles, ArrowRight } from "lucide-react"

export const IdeaSuggestionsBox = () => {
	const { t } = useTranslation("kilocode")
	const { taskHistoryVersion } = useExtensionState()
	const ideas = Object.values(t("ideaSuggestionsBox.ideas", { returnObjects: true }))

	const [iconsBaseUri] = useState(() => {
		const w = window as any
		return w.ICONS_BASE_URI || ""
	})

	// Check if current workspace has any tasks
	const { data } = useTaskHistory(
		{
			workspace: "current",
			sort: "newest",
			favoritesOnly: false,
			pageIndex: 0,
		},
		taskHistoryVersion,
	)
	const hasWorkspaceTasks = (data?.historyItems?.length ?? 0) > 0

	// Show 3-4 random ideas - memoized to prevent re-shuffling on re-renders
	// Must be called before early return to satisfy React hooks rules
	const shuffledIdeas = useMemo(() => [...ideas].sort(() => Math.random() - 0.5).slice(0, 4), [ideas])

	// Don't show if workspace has tasks
	if (hasWorkspaceTasks) {
		return null
	}

	const handleIdeaClick = (idea: string) => {
		vscode.postMessage({
			type: "newTask",
			text: idea,
			images: [],
		})

		telemetryClient.capture(TelemetryEventName.SUGGESTION_BUTTON_CLICKED, {
			idea,
		})
	}

	return (
		<div className="mt-6 mb-4 flex flex-col items-center">
			{/* Kilo Logo */}
			<div
				className="mb-5 flex items-center justify-center"
				style={{
					width: "56px",
					height: "56px",
				}}>
				<img
					src={`${iconsBaseUri}/kilo-dark.svg`}
					alt="Kilo Code"
					className="w-full h-full object-contain"
					style={{
						opacity: 0.85,
					}}
				/>
			</div>

			{/* Content Box */}
			<div className="w-full p-5 rounded-md border border-vscode-panel-border bg-vscode-input-background">
				{/* Header section */}
				<div className="text-center mb-5">
					<div className="inline-flex items-center gap-2 mb-2">
						<Sparkles className="w-4 h-4 text-vscode-focusBorder" />
						<p className="text-base font-semibold text-vscode-foreground m-0">
							{t("ideaSuggestionsBox.newHere")}
						</p>
						<Sparkles className="w-4 h-4 text-vscode-focusBorder" />
					</div>
					<p className="text-sm text-vscode-descriptionForeground m-0">
						{t("ideaSuggestionsBox.tryOneOfThese")}
					</p>
				</div>

				{/* Suggestion Cards */}
				<div className="flex flex-col gap-2.5">
					{shuffledIdeas.map((idea, index) => (
						<button
							key={index}
							onClick={() => handleIdeaClick(idea)}
							className="group w-full px-4 py-3 text-left text-sm rounded border border-vscode-panel-border cursor-pointer transition-all duration-200 hover:border-vscode-focusBorder hover:shadow-sm bg-vscode-editor-background">
							<div className="flex items-start gap-3">
								<div
									className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center transition-colors duration-200 group-hover:bg-vscode-focusBorder"
									style={{
										background: "color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent)",
									}}>
									<Lightbulb className="w-4 h-4 text-vscode-focusBorder transition-colors duration-200 group-hover:text-vscode-editor-background" />
								</div>
								<span className="flex-1 text-vscode-foreground leading-relaxed pt-0.5">{idea}</span>
								<ArrowRight className="w-4 h-4 text-vscode-descriptionForeground opacity-0 group-hover:opacity-100 transition-opacity duration-200 mt-1" />
							</div>
						</button>
					))}
				</div>

				{/* Footer hint */}
				<div className="mt-4 pt-3 border-t border-vscode-panel-border">
					<p className="text-center text-xs text-vscode-descriptionForeground m-0 flex items-center justify-center gap-1.5">
						<span className="codicon codicon-info" />
						{t("ideaSuggestionsBox.clickToInsert")}
					</p>
				</div>
			</div>
		</div>
	)
}
