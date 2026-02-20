// kilocode_change - new file

interface RadarDataPoint {
	label: string
	value: number // 0-10 scale
}

interface RadarSeries {
	modelName: string
	data: RadarDataPoint[]
	color: string
}

interface BenchRadarChartProps {
	series: RadarSeries[]
	size?: number
}

const MODEL_COLORS = [
	"var(--vscode-charts-blue)",
	"var(--vscode-charts-red)",
	"var(--vscode-charts-green)",
	"var(--vscode-charts-yellow)",
	"var(--vscode-charts-purple)",
	"var(--vscode-charts-orange)",
]

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
	const radians = (angle - 90) * (Math.PI / 180)
	return {
		x: cx + r * Math.cos(radians),
		y: cy + r * Math.sin(radians),
	}
}

export function BenchRadarChart({ series, size = 220 }: BenchRadarChartProps) {
	if (series.length === 0 || series[0].data.length === 0) {
		return <div className="text-xs text-vscode-descriptionForeground text-center p-4">No data for radar chart</div>
	}

	const cx = size / 2
	const cy = size / 2
	const maxRadius = size / 2 - 30
	const numAxes = series[0].data.length
	const angleStep = 360 / numAxes

	// Grid rings (at 2, 4, 6, 8, 10)
	const rings = [2, 4, 6, 8, 10]

	// Axis lines and labels
	const axes = series[0].data.map((d, i) => {
		const angle = i * angleStep
		const end = polarToCartesian(cx, cy, maxRadius, angle)
		const labelPos = polarToCartesian(cx, cy, maxRadius + 14, angle)
		return { label: d.label, end, labelPos, angle }
	})

	return (
		<div className="space-y-2">
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
				{/* Grid rings */}
				{rings.map((ring) => (
					<polygon
						key={ring}
						points={Array.from({ length: numAxes }, (_, i) => {
							const p = polarToCartesian(cx, cy, (ring / 10) * maxRadius, i * angleStep)
							return `${p.x},${p.y}`
						}).join(" ")}
						fill="none"
						stroke="var(--vscode-panel-border)"
						strokeWidth={0.5}
						opacity={0.5}
					/>
				))}

				{/* Axis lines */}
				{axes.map((axis, i) => (
					<line
						key={i}
						x1={cx}
						y1={cy}
						x2={axis.end.x}
						y2={axis.end.y}
						stroke="var(--vscode-panel-border)"
						strokeWidth={0.5}
						opacity={0.5}
					/>
				))}

				{/* Data polygons */}
				{series.map((s, si) => {
					const points = s.data
						.map((d, i) => {
							const r = (Math.max(0, Math.min(10, d.value)) / 10) * maxRadius
							const p = polarToCartesian(cx, cy, r, i * angleStep)
							return `${p.x},${p.y}`
						})
						.join(" ")

					return (
						<g key={si}>
							<polygon
								points={points}
								fill={s.color || MODEL_COLORS[si % MODEL_COLORS.length]}
								fillOpacity={0.15}
								stroke={s.color || MODEL_COLORS[si % MODEL_COLORS.length]}
								strokeWidth={1.5}
							/>
							{/* Data points */}
							{s.data.map((d, i) => {
								const r = (Math.max(0, Math.min(10, d.value)) / 10) * maxRadius
								const p = polarToCartesian(cx, cy, r, i * angleStep)
								return (
									<circle
										key={i}
										cx={p.x}
										cy={p.y}
										r={2.5}
										fill={s.color || MODEL_COLORS[si % MODEL_COLORS.length]}
									/>
								)
							})}
						</g>
					)
				})}

				{/* Axis labels */}
				{axes.map((axis, i) => (
					<text
						key={i}
						x={axis.labelPos.x}
						y={axis.labelPos.y}
						textAnchor="middle"
						dominantBaseline="central"
						fontSize={9}
						fill="var(--vscode-descriptionForeground)">
						{axis.label}
					</text>
				))}
			</svg>

			{/* Legend */}
			{series.length > 1 && (
				<div className="flex flex-wrap justify-center gap-3 text-[10px]">
					{series.map((s, si) => (
						<div key={si} className="flex items-center gap-1">
							<div
								className="w-2.5 h-2.5 rounded-full"
								style={{ backgroundColor: s.color || MODEL_COLORS[si % MODEL_COLORS.length] }}
							/>
							<span className="text-vscode-descriptionForeground truncate max-w-[100px]">
								{s.modelName}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export { MODEL_COLORS }
