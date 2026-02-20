// kilocode_change - new file
import { MODEL_COLORS } from "./BenchRadarChart"

interface ModelResult {
	modelId: string
	modelName: string
	modeScores: Record<string, number>
}

interface BenchModeBreakdownProps {
	results: ModelResult[]
}

const MODE_LABELS: Record<string, string> = {
	architect: "Architect",
	code: "Code",
	debug: "Debug",
	ask: "Ask",
	orchestrator: "Orchestrator",
}

export function BenchModeBreakdown({ results }: BenchModeBreakdownProps) {
	if (results.length === 0) return null

	// Collect all modes across all models
	const allModes = new Set<string>()
	results.forEach((r) => Object.keys(r.modeScores).forEach((m) => allModes.add(m)))
	const modes = Array.from(allModes)

	if (modes.length === 0) return null

	return (
		<div className="space-y-3">
			<h4 className="text-sm font-medium text-vscode-foreground">Mode Breakdown</h4>
			<div className="space-y-4">
				{modes.map((mode) => (
					<div key={mode} className="space-y-1.5">
						<div className="text-xs font-medium text-vscode-descriptionForeground">
							{MODE_LABELS[mode] || mode}
						</div>
						<div className="space-y-1">
							{results.map((model, mi) => {
								const score = model.modeScores[mode] || 0
								const pct = (score / 10) * 100
								return (
									<div key={model.modelId} className="flex items-center gap-2">
										<div className="text-[10px] text-vscode-descriptionForeground w-24 truncate">
											{model.modelName}
										</div>
										<div className="flex-1 h-2 bg-vscode-editor-background rounded-full overflow-hidden">
											<div
												className="h-full rounded-full transition-all"
												style={{
													width: `${pct}%`,
													backgroundColor: MODEL_COLORS[mi % MODEL_COLORS.length],
												}}
											/>
										</div>
										<div className="text-[10px] font-mono text-vscode-descriptionForeground w-8 text-right">
											{score.toFixed(1)}
										</div>
									</div>
								)
							})}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
