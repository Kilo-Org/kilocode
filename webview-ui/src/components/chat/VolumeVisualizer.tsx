// kilocode_change - new file: Volume visualizer component for microphone input
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface VolumeVisualizerProps {
	/** Volume level from 0 to 1 */
	volume: number
	/** Whether recording is active */
	isActive?: boolean
	/** Custom className */
	className?: string
}

const BAR_COUNT = 5
const BAR_WIDTH = 2
const BAR_GAP = 2
const MAX_HEIGHT = 16
const MIN_HEIGHT_PERCENT = 10
const EASING = 0.15
const ANIMATION_THRESHOLD = 0.001

// Energy normalization constants
// Based on real FFmpeg PCM16 energy values which typically range 0.02-0.10
const ENERGY_MIN = 0.02 // Voice detection threshold
const ENERGY_MAX = 0.12 // Realistic maximum for normal speech (reduced for more sensitivity)
const ENERGY_SCALE = 2.0 // Base amplification (increased from 1.5)
const ENERGY_CURVE = 0.6 // Exponential curve (<1 = boost quiet sounds more)

interface AnimationState {
	targetHeights: number[]
	currentHeights: number[]
	frameId: number | null
}

/**
 * Normalize raw energy (0.02-0.15) to visual range (0-1)
 * Uses exponential scaling to make quiet sounds more visible
 *
 * Curve explanation:
 * - Linear: normalized * scale
 * - Exponential (curve<1): pow(normalized, 0.6) - boosts low values more
 * - Result: Tiny sounds near threshold get animated, loud sounds still natural
 */
function normalizeEnergy(rawEnergy: number): number {
	// Map 0.02-0.12 range to 0-1
	const normalized = Math.max(0, (rawEnergy - ENERGY_MIN) / (ENERGY_MAX - ENERGY_MIN))

	// Apply exponential curve (0.6 power boosts low values)
	// Example: 0.1 linear → 0.25 exponential (2.5x boost for quiet sounds)
	const curved = Math.pow(normalized, ENERGY_CURVE)

	// Apply final scaling and clamp
	const amplified = Math.min(1, curved * ENERGY_SCALE)
	return amplified
}

function calculateTargetHeights(volume: number): number[] {
	// Normalize the raw energy value for better visual response
	const normalizedVolume = normalizeEnergy(volume)

	const centerIndex = Math.floor(BAR_COUNT / 2)
	return Array.from({ length: BAR_COUNT }, (_, i) => {
		const distanceFromCenter = Math.abs(i - centerIndex)
		const heightMultiplier = 1 - distanceFromCenter * 0.15
		const randomness = 0.85 + Math.random() * 0.15
		return normalizedVolume * heightMultiplier * randomness
	})
}

/**
 * VolumeVisualizer - Animated vertical bars that respond to audio volume
 *
 * Features:
 * - 5 vertical bars with staggered heights based on volume
 * - Smooth spring-like animation with easing
 * - Yellow color when active, gray when inactive
 * - Responsive to volume changes (0-1 scale)
 * - Uses REAL audio energy from FFmpeg PCM16 analysis
 */
export function VolumeVisualizer({ volume, isActive = true, className }: VolumeVisualizerProps) {
	const [barHeights, setBarHeights] = useState<number[]>(new Array(BAR_COUNT).fill(MIN_HEIGHT_PERCENT))
	const volumeRef = useRef(volume)
	const animationRef = useRef<AnimationState>({
		targetHeights: new Array(BAR_COUNT).fill(0),
		currentHeights: new Array(BAR_COUNT).fill(0),
		frameId: null,
	})

	// Update volume ref without triggering re-render
	useEffect(() => {
		volumeRef.current = volume
	}, [volume])

	useEffect(() => {
		if (!isActive) {
			// Reset to minimum when inactive
			setBarHeights(new Array(BAR_COUNT).fill(MIN_HEIGHT_PERCENT))
			return
		}

		const state = animationRef.current

		const animate = () => {
			if (!isActive) {
				state.frameId = null
				return
			}

			// Use REAL volume from ref (updated every frame without restarting animation)
			state.targetHeights = calculateTargetHeights(volumeRef.current)

			const newHeights = state.currentHeights.map((current, i) => {
				const target = state.targetHeights[i]
				const diff = target - current

				if (Math.abs(diff) > ANIMATION_THRESHOLD) {
					return current + diff * EASING
				}

				return current
			})

			state.currentHeights = newHeights
			setBarHeights(newHeights.map((h) => Math.max(MIN_HEIGHT_PERCENT, h * 100)))
			state.frameId = requestAnimationFrame(animate)
		}

		state.frameId = requestAnimationFrame(animate)

		return () => {
			if (state.frameId !== null) {
				cancelAnimationFrame(state.frameId)
				state.frameId = null
			}
		}
	}, [isActive]) // Removed volume from dependencies - animation runs continuously

	return (
		<div
			className={cn("inline-flex items-end justify-center", className)}
			style={{
				gap: `${BAR_GAP}px`,
				height: `${MAX_HEIGHT}px`,
			}}
			aria-label="Volume level indicator"
			role="meter"
			aria-valuenow={Math.round(volume * 100)}
			aria-valuemin={0}
			aria-valuemax={100}>
			{barHeights.map((height, i) => (
				<div
					key={i}
					className={cn("rounded-full transition-colors duration-200")}
					style={{
						width: `${BAR_WIDTH}px`,
						height: `${height}%`,
						minHeight: `${MIN_HEIGHT_PERCENT}%`,
						backgroundColor: isActive
							? "var(--vscode-charts-yellow)"
							: "var(--vscode-descriptionForeground)",
						opacity: isActive ? 1 : 0.4,
					}}
				/>
			))}
		</div>
	)
}
