import { memo } from "react"
import { cn } from "@/lib/utils"

interface CircularProgressProps {
	/** Progress percentage (0-100) */
	percentage: number
	/** Size of the SVG in pixels (default: 16) */
	size?: number
	/** Stroke width in pixels (default: 2) */
	strokeWidth?: number
	/** Additional CSS classes */
	className?: string
}

/**
 * A circular progress indicator component that displays a percentage as a ring.
 * The ring fills clockwise from the top based on the percentage value.
 *
 * @example
 * ```tsx
 * <CircularProgress percentage={75} />
 * <CircularProgress percentage={50} size={24} strokeWidth={3} />
 * ```
 */
export const CircularProgress = memo(function CircularProgress({
	percentage,
	size = 16,
	strokeWidth = 2,
	className,
}: CircularProgressProps) {
	// Clamp percentage between 0 and 100
	const clampedPercentage = Math.max(0, Math.min(100, percentage))

	// Calculate the radius based on size and stroke width
	// The radius needs to fit within the viewBox accounting for stroke width
	const radius = (size - strokeWidth) / 2
	const center = size / 2

	// Calculate the circumference and dash offset for the progress ring
	const circumference = 2 * Math.PI * radius
	const strokeDashoffset = circumference - (clampedPercentage / 100) * circumference

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			className={cn("shrink-0", className)}
			role="progressbar"
			aria-valuenow={clampedPercentage}
			aria-valuemin={0}
			aria-valuemax={100}>
			{/* Background circle */}
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				opacity="0.2"
			/>
			{/* Progress circle */}
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeDasharray={circumference}
				strokeDashoffset={strokeDashoffset}
				strokeLinecap="round"
				transform={`rotate(-90 ${center} ${center})`}
			/>
		</svg>
	)
})
