// kilocode_change - new file
import { useState } from "react"
import { BarChart3, GitCompare, Settings, Target, DollarSign, RefreshCw, Download } from "lucide-react"
import { Button } from "@/components/ui"
import { BenchLeaderboard } from "./BenchLeaderboard"
import { BenchRadarChart, MODEL_COLORS } from "./BenchRadarChart"
import { BenchModeBreakdown } from "./BenchModeBreakdown"
import { BenchHeadToHead } from "./BenchHeadToHead"
import { BenchCostOptimizer } from "./BenchCostOptimizer"
import { BenchSettings } from "./BenchSettings"

interface BenchRunResult {
	id: string
	runAt: string
	models: string[]
	results: Array<{
		modelId: string
		modelName: string
		problems: Array<{
			problemId: string
			mode: string
			responseContent: string
			ttft: number
			totalTime: number
			inputTokens: number
			outputTokens: number
			cost: number
			evaluation: {
				qualityScore: number
				relevanceScore: number
				qualityRationale: string
				relevanceRationale: string
				speedScore: number
				costScore: number
				compositeScore: number
			}
		}>
		aggregateScore: number
		modeScores: Record<string, number>
		totalCost: number
		totalInputTokens: number
		totalOutputTokens: number
		totalTime: number
	}>
}

type DashboardSection = "overview" | "headToHead" | "cost" | "settings"

interface BenchDashboardProps {
	result: BenchRunResult
	onNewBenchmark: () => void
}

export function BenchDashboard({ result, onNewBenchmark }: BenchDashboardProps) {
	const [section, setSection] = useState<DashboardSection>("overview")

	if (section === "settings") {
		return <BenchSettings onClose={() => setSection("overview")} />
	}

	// Build radar chart data
	const radarSeries = result.results.map((model, mi) => {
		// Average quality, relevance, speed, cost across all problems
		const avgQuality =
			model.problems.reduce((s, p) => s + p.evaluation.qualityScore, 0) / (model.problems.length || 1)
		const avgRelevance =
			model.problems.reduce((s, p) => s + p.evaluation.relevanceScore, 0) / (model.problems.length || 1)
		const avgSpeed = model.problems.reduce((s, p) => s + p.evaluation.speedScore, 0) / (model.problems.length || 1)
		const avgCost = model.problems.reduce((s, p) => s + p.evaluation.costScore, 0) / (model.problems.length || 1)

		return {
			modelName: model.modelName,
			color: MODEL_COLORS[mi % MODEL_COLORS.length],
			data: [
				{ label: "Quality", value: avgQuality },
				{ label: "Relevance", value: avgRelevance },
				{ label: "Speed", value: avgSpeed },
				{ label: "Cost", value: avgCost },
			],
		}
	})

	return (
		<div className="space-y-5">
			{/* Header with section navigation */}
			<div className="flex items-center justify-between">
				<div className="text-xs text-vscode-descriptionForeground">
					{result.results.length} model{result.results.length !== 1 ? "s" : ""} benchmarked
					{" · "}
					{new Date(result.runAt).toLocaleDateString()}
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						title="Export results as JSON"
						onClick={() => {
							const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
							const url = URL.createObjectURL(blob)
							const a = document.createElement("a")
							a.href = url
							a.download = `bench-${result.id}.json`
							a.click()
							URL.revokeObjectURL(url)
						}}>
						<Download className="w-3.5 h-3.5" />
					</Button>
					<Button variant="ghost" size="sm" onClick={onNewBenchmark} className="h-7 px-2">
						<RefreshCw className="w-3.5 h-3.5 mr-1" />
						<span className="text-xs">New Run</span>
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setSection("settings")} className="h-7 px-2">
						<Settings className="w-3.5 h-3.5" />
					</Button>
				</div>
			</div>

			{/* Section tabs */}
			<div className="flex items-center gap-1 border-b border-vscode-panel-border pb-1">
				{[
					{ key: "overview" as const, icon: BarChart3, label: "Overview" },
					{ key: "headToHead" as const, icon: GitCompare, label: "Head-to-Head" },
					{ key: "cost" as const, icon: DollarSign, label: "Cost" },
				].map(({ key, icon: Icon, label }) => (
					<button
						key={key}
						className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-t transition-colors ${
							section === key
								? "text-vscode-foreground bg-vscode-editor-background border border-b-0 border-vscode-panel-border -mb-px"
								: "text-vscode-descriptionForeground hover:text-vscode-foreground"
						}`}
						onClick={() => setSection(key)}>
						<Icon className="w-3.5 h-3.5" />
						{label}
					</button>
				))}
			</div>

			{/* Section content */}
			{section === "overview" && (
				<div className="space-y-6">
					<BenchLeaderboard results={result.results} />
					{result.results.length > 0 && (
						<div className="flex items-start gap-4">
							<div className="flex-1">
								<div className="flex items-center gap-2 mb-3">
									<Target className="w-4 h-4 text-vscode-foreground" />
									<h4 className="text-sm font-medium text-vscode-foreground">Performance Radar</h4>
								</div>
								<BenchRadarChart series={radarSeries} />
							</div>
						</div>
					)}
					<BenchModeBreakdown results={result.results} />
				</div>
			)}

			{section === "headToHead" && <BenchHeadToHead results={result.results} />}

			{section === "cost" && <BenchCostOptimizer results={result.results} />}
		</div>
	)
}
