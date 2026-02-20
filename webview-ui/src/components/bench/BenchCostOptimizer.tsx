// kilocode_change - new file
import { MODEL_COLORS } from "./BenchRadarChart"

interface ModelResult {
	modelId: string
	modelName: string
	aggregateScore: number
	totalCost: number
}

interface BenchCostOptimizerProps {
	results: ModelResult[]
}

export function BenchCostOptimizer({ results }: BenchCostOptimizerProps) {
	if (results.length === 0) return null

	// SVG chart dimensions
	const width = 280
	const height = 180
	const padding = { top: 20, right: 20, bottom: 30, left: 40 }
	const plotW = width - padding.left - padding.right
	const plotH = height - padding.top - padding.bottom

	// Calculate scales
	const maxScore = Math.max(...results.map((r) => r.aggregateScore), 1)
	const maxCost = Math.max(...results.map((r) => r.totalCost), 0.001)

	const scaleX = (cost: number) => padding.left + (cost / maxCost) * plotW
	const scaleY = (score: number) => padding.top + plotH - (score / maxScore) * plotH

	// Find the best value (highest score/cost ratio)
	const bestValue = results.reduce(
		(best, r) => {
			const ratio = r.totalCost > 0 ? r.aggregateScore / r.totalCost : 0
			return ratio > best.ratio ? { model: r.modelName, ratio } : best
		},
		{ model: "", ratio: 0 },
	)

	return (
		<div className="space-y-3">
			<h4 className="text-sm font-medium text-vscode-foreground">Cost vs Quality</h4>

			<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mx-auto">
				{/* Grid lines */}
				{[0.25, 0.5, 0.75, 1].map((pct) => (
					<g key={pct}>
						<line
							x1={padding.left}
							y1={padding.top + plotH * (1 - pct)}
							x2={padding.left + plotW}
							y2={padding.top + plotH * (1 - pct)}
							stroke="var(--vscode-panel-border)"
							strokeWidth={0.5}
							opacity={0.3}
						/>
						<line
							x1={padding.left + plotW * pct}
							y1={padding.top}
							x2={padding.left + plotW * pct}
							y2={padding.top + plotH}
							stroke="var(--vscode-panel-border)"
							strokeWidth={0.5}
							opacity={0.3}
						/>
					</g>
				))}

				{/* Axes */}
				<line
					x1={padding.left}
					y1={padding.top + plotH}
					x2={padding.left + plotW}
					y2={padding.top + plotH}
					stroke="var(--vscode-panel-border)"
					strokeWidth={1}
				/>
				<line
					x1={padding.left}
					y1={padding.top}
					x2={padding.left}
					y2={padding.top + plotH}
					stroke="var(--vscode-panel-border)"
					strokeWidth={1}
				/>

				{/* Axis labels */}
				<text
					x={padding.left + plotW / 2}
					y={height - 4}
					textAnchor="middle"
					fontSize={9}
					fill="var(--vscode-descriptionForeground)">
					Cost ($)
				</text>
				<text
					x={10}
					y={padding.top + plotH / 2}
					textAnchor="middle"
					fontSize={9}
					fill="var(--vscode-descriptionForeground)"
					transform={`rotate(-90, 10, ${padding.top + plotH / 2})`}>
					Score
				</text>

				{/* Data points */}
				{results.map((r, i) => {
					const x = scaleX(r.totalCost)
					const y = scaleY(r.aggregateScore)
					const color = MODEL_COLORS[i % MODEL_COLORS.length]
					return (
						<g key={r.modelId}>
							<circle cx={x} cy={y} r={5} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={1} />
							<text
								x={x}
								y={y - 8}
								textAnchor="middle"
								fontSize={8}
								fill="var(--vscode-descriptionForeground)">
								{r.modelName.length > 15 ? r.modelName.slice(0, 12) + "..." : r.modelName}
							</text>
						</g>
					)
				})}
			</svg>

			{/* Best value callout */}
			{bestValue.model && (
				<div className="text-center text-[10px] text-vscode-descriptionForeground">
					Best value: <span className="text-vscode-foreground font-medium">{bestValue.model}</span>
				</div>
			)}
		</div>
	)
}
