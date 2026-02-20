// kilocode_change - new file
import { useState } from "react"

interface ProblemResult {
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
		compositeScore: number
		qualityRationale: string
		relevanceRationale: string
	}
}

interface ModelResult {
	modelId: string
	modelName: string
	problems: ProblemResult[]
	aggregateScore: number
}

interface BenchHeadToHeadProps {
	results: ModelResult[]
}

export function BenchHeadToHead({ results }: BenchHeadToHeadProps) {
	const [modelA, setModelA] = useState(results[0]?.modelId || "")
	const [modelB, setModelB] = useState(results[1]?.modelId || results[0]?.modelId || "")

	const resultA = results.find((r) => r.modelId === modelA)
	const resultB = results.find((r) => r.modelId === modelB)

	if (results.length < 2) {
		return (
			<div className="text-xs text-vscode-descriptionForeground text-center p-4">
				Need at least 2 models for head-to-head comparison
			</div>
		)
	}

	// Get problems that both models answered
	const commonProblems =
		resultA?.problems.filter((pa) => resultB?.problems.some((pb) => pb.problemId === pa.problemId)) || []

	return (
		<div className="space-y-3">
			<h4 className="text-sm font-medium text-vscode-foreground">Head-to-Head</h4>

			{/* Model selectors */}
			<div className="flex items-center gap-3">
				<select
					className="flex-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1"
					value={modelA}
					onChange={(e) => setModelA(e.target.value)}>
					{results.map((r) => (
						<option key={r.modelId} value={r.modelId}>
							{r.modelName}
						</option>
					))}
				</select>
				<span className="text-xs text-vscode-descriptionForeground">vs</span>
				<select
					className="flex-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1"
					value={modelB}
					onChange={(e) => setModelB(e.target.value)}>
					{results.map((r) => (
						<option key={r.modelId} value={r.modelId}>
							{r.modelName}
						</option>
					))}
				</select>
			</div>

			{/* Comparison table */}
			{resultA && resultB && (
				<div className="border border-vscode-panel-border rounded-md overflow-hidden">
					<table className="w-full text-xs">
						<thead>
							<tr className="bg-vscode-editor-background border-b border-vscode-panel-border">
								<th className="text-left px-3 py-2 text-vscode-descriptionForeground font-medium">
									Problem
								</th>
								<th className="text-right px-3 py-2 text-vscode-descriptionForeground font-medium truncate max-w-[80px]">
									{resultA.modelName}
								</th>
								<th className="text-right px-3 py-2 text-vscode-descriptionForeground font-medium truncate max-w-[80px]">
									{resultB.modelName}
								</th>
								<th className="text-center px-3 py-2 text-vscode-descriptionForeground font-medium">
									Winner
								</th>
							</tr>
						</thead>
						<tbody>
							{commonProblems.map((pa) => {
								const pb = resultB?.problems.find((p) => p.problemId === pa.problemId)
								if (!pb) return null
								const scoreA = pa.evaluation.compositeScore
								const scoreB = pb.evaluation.compositeScore
								const winner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "tie"

								return (
									<tr
										key={pa.problemId}
										className="border-b border-vscode-panel-border last:border-0">
										<td className="px-3 py-2 text-vscode-foreground">
											<div className="text-[10px] text-vscode-descriptionForeground">
												{pa.mode}
											</div>
											<div className="truncate max-w-[150px]">{pa.problemId}</div>
										</td>
										<td
											className={`px-3 py-2 text-right font-mono ${winner === "A" ? "text-vscode-foreground font-bold" : "text-vscode-descriptionForeground"}`}>
											{scoreA.toFixed(1)}
										</td>
										<td
											className={`px-3 py-2 text-right font-mono ${winner === "B" ? "text-vscode-foreground font-bold" : "text-vscode-descriptionForeground"}`}>
											{scoreB.toFixed(1)}
										</td>
										<td className="px-3 py-2 text-center text-[10px]">
											{winner === "tie" ? (
												<span className="text-vscode-descriptionForeground">Tie</span>
											) : winner === "A" ? (
												<span className="text-vscode-foreground">
													{resultA.modelName.slice(0, 15)}
												</span>
											) : (
												<span className="text-vscode-foreground">
													{resultB.modelName.slice(0, 15)}
												</span>
											)}
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			)}

			{/* Summary */}
			{resultA && resultB && (
				<div className="flex justify-between text-xs text-vscode-descriptionForeground">
					<span>
						{resultA.modelName}: {resultA.aggregateScore.toFixed(1)} avg
					</span>
					<span>
						{resultB.modelName}: {resultB.aggregateScore.toFixed(1)} avg
					</span>
				</div>
			)}
		</div>
	)
}
