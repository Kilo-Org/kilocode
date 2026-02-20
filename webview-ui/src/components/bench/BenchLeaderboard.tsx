// kilocode_change - new file
import { Trophy, ArrowUp, ArrowDown, Check } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui"
import { vscode } from "@src/utils/vscode"

interface ModelResult {
	modelId: string
	modelName: string
	aggregateScore: number
	modeScores: Record<string, number>
	totalCost: number
	totalInputTokens: number
	totalOutputTokens: number
	totalTime: number
}

interface BenchLeaderboardProps {
	results: ModelResult[]
	onSelectModel?: (modelId: string) => void
}

type SortKey = "score" | "cost" | "time"

export function BenchLeaderboard({ results, onSelectModel }: BenchLeaderboardProps) {
	const [sortKey, setSortKey] = useState<SortKey>("score")
	const [sortAsc, setSortAsc] = useState(false)

	const sorted = [...results].sort((a, b) => {
		let diff = 0
		switch (sortKey) {
			case "score":
				diff = a.aggregateScore - b.aggregateScore
				break
			case "cost":
				diff = a.totalCost - b.totalCost
				break
			case "time":
				diff = a.totalTime - b.totalTime
				break
		}
		return sortAsc ? diff : -diff
	})

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			setSortAsc(!sortAsc)
		} else {
			setSortKey(key)
			setSortAsc(key === "cost" || key === "time")
		}
	}

	const handleUseModel = (modelId: string) => {
		vscode.postMessage({ type: "benchSetActiveModel", benchModelId: modelId })
	}

	const SortIcon = ({ active, asc }: { active: boolean; asc: boolean }) =>
		active ? (
			asc ? (
				<ArrowUp className="w-3 h-3 inline ml-0.5" />
			) : (
				<ArrowDown className="w-3 h-3 inline ml-0.5" />
			)
		) : null

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Trophy className="w-4 h-4 text-vscode-foreground" />
				<h4 className="text-sm font-medium text-vscode-foreground">Leaderboard</h4>
			</div>

			<div className="border border-vscode-panel-border rounded-md overflow-hidden">
				<table className="w-full text-xs">
					<thead>
						<tr className="bg-vscode-editor-background border-b border-vscode-panel-border">
							<th className="text-left px-3 py-2 text-vscode-descriptionForeground font-medium">#</th>
							<th className="text-left px-3 py-2 text-vscode-descriptionForeground font-medium">Model</th>
							<th
								className="text-right px-3 py-2 text-vscode-descriptionForeground font-medium cursor-pointer hover:text-vscode-foreground"
								onClick={() => toggleSort("score")}>
								Score
								<SortIcon active={sortKey === "score"} asc={sortAsc} />
							</th>
							<th
								className="text-right px-3 py-2 text-vscode-descriptionForeground font-medium cursor-pointer hover:text-vscode-foreground"
								onClick={() => toggleSort("cost")}>
								Cost
								<SortIcon active={sortKey === "cost"} asc={sortAsc} />
							</th>
							<th
								className="text-right px-3 py-2 text-vscode-descriptionForeground font-medium cursor-pointer hover:text-vscode-foreground"
								onClick={() => toggleSort("time")}>
								Time
								<SortIcon active={sortKey === "time"} asc={sortAsc} />
							</th>
							<th className="text-right px-3 py-2 text-vscode-descriptionForeground font-medium">
								Tokens
							</th>
							<th className="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((model, idx) => (
							<tr
								key={model.modelId}
								className="border-b border-vscode-panel-border last:border-0 hover:bg-vscode-list-hoverBackground">
								<td
									className="px-3 py-2 text-vscode-descriptionForeground cursor-pointer"
									onClick={() => onSelectModel?.(model.modelId)}>
									{idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
								</td>
								<td
									className="px-3 py-2 text-vscode-foreground font-medium truncate max-w-[150px] cursor-pointer"
									onClick={() => onSelectModel?.(model.modelId)}>
									{model.modelName}
								</td>
								<td className="px-3 py-2 text-right font-mono text-vscode-foreground">
									{model.aggregateScore.toFixed(1)}
								</td>
								<td className="px-3 py-2 text-right font-mono text-vscode-descriptionForeground">
									${model.totalCost.toFixed(4)}
								</td>
								<td className="px-3 py-2 text-right font-mono text-vscode-descriptionForeground">
									{(model.totalTime / 1000).toFixed(1)}s
								</td>
								<td className="px-3 py-2 text-right font-mono text-vscode-descriptionForeground">
									{((model.totalInputTokens + model.totalOutputTokens) / 1000).toFixed(1)}k
								</td>
								<td className="px-2 py-1.5">
									<Button
										variant="ghost"
										size="sm"
										className="h-6 px-1.5 text-[10px]"
										onClick={() => handleUseModel(model.modelId)}
										title={`Set ${model.modelName} as active model`}>
										<Check className="w-3 h-3 mr-0.5" />
										Use
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
