// kilocode_change - new file
import { memo, useMemo } from "react"
import { cn } from "@/lib/utils"
import { StandardTooltip } from "@src/components/ui"

export interface DiffStatsDisplayProps {
	added: number
	removed: number
	/** Maximum number of boxes to display (default: 0) */
	maxBoxes?: number
	/** Optional className for the container */
	className?: string
}

/**
 * GitHub-style diff stats display component.
 *
 * Shows lines added/removed with colored boxes representing the proportion
 * of additions vs deletions, similar to GitHub's PR diff stats UI.
 *
 * Example: +8 −4 with 4 green boxes, 1 red box, and 0 empty boxes
 */
const DiffStatsDisplay = ({ added, removed, maxBoxes = 0, className }: DiffStatsDisplayProps) => {
	const { greenBoxes, redBoxes, emptyBoxes, tooltipText } = useMemo(() => {
		const total = added + removed

		if (total === 0) {
			return {
				greenBoxes: 0,
				redBoxes: 0,
				emptyBoxes: maxBoxes,
				tooltipText: "No changes",
			}
		}

		const tooltipText = `${added} addition${added !== 1 ? "s" : ""} & ${removed} deletion${removed !== 1 ? "s" : ""}`

		if (maxBoxes === 0) {
			return { greenBoxes: 0, redBoxes: 0, emptyBoxes: 0, tooltipText }
		}

		// Calculate proportional boxes
		const greenRatio = added / total
		const redRatio = removed / total

		// Round to nearest integer, ensuring at least 1 box for non-zero values
		let greenBoxes = Math.round(greenRatio * maxBoxes)
		let redBoxes = Math.round(redRatio * maxBoxes)

		// Ensure at least 1 box for non-zero values
		if (added > 0 && greenBoxes === 0) {
			greenBoxes = 1
		}
		if (removed > 0 && redBoxes === 0) {
			redBoxes = 1
		}

		// Adjust if we exceeded maxBoxes due to rounding
		const totalBoxes = greenBoxes + redBoxes
		if (totalBoxes > maxBoxes) {
			// Reduce the larger one
			if (greenBoxes > redBoxes) {
				greenBoxes = maxBoxes - redBoxes
			} else {
				redBoxes = maxBoxes - greenBoxes
			}
		}

		// Calculate empty boxes
		const emptyBoxes = Math.max(0, maxBoxes - greenBoxes - redBoxes)

		return { greenBoxes, redBoxes, emptyBoxes, tooltipText }
	}, [added, removed, maxBoxes])

	// Don't render if there are no changes
	if (added === 0 && removed === 0) {
		return null
	}

	return (
		<StandardTooltip content={tooltipText}>
			<div className={cn("flex items-center gap-1.5", className)}>
				{/* Lines added */}
				<span className="font-medium text-vscode-charts-green">+{added}</span>

				{/* Lines removed */}
				<span className="font-medium text-vscode-charts-red">−{removed}</span>

				{/* Diff boxes */}
				<div className="flex gap-px">
					{/* Green boxes for additions */}
					{Array.from({ length: greenBoxes }).map((_, i) => (
						<div
							key={`green-${i}`}
							className="w-2 h-2 rounded-[1px] bg-vscode-charts-green"
							aria-hidden="true"
						/>
					))}

					{/* Red boxes for deletions */}
					{Array.from({ length: redBoxes }).map((_, i) => (
						<div
							key={`red-${i}`}
							className="w-2 h-2 rounded-[1px] bg-vscode-charts-red"
							aria-hidden="true"
						/>
					))}

					{/* Empty boxes */}
					{Array.from({ length: emptyBoxes }).map((_, i) => (
						<div
							key={`empty-${i}`}
							className="w-2 h-2 rounded-[1px] bg-vscode-descriptionForeground/30"
							aria-hidden="true"
						/>
					))}
				</div>
			</div>
		</StandardTooltip>
	)
}

export default memo(DiffStatsDisplay)
