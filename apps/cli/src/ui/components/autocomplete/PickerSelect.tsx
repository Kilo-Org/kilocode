import { useRef, useMemo, type ReactNode } from "react"
import { Box, Text, useInput } from "ink"

import type { AutocompleteItem } from "./types.js"

export interface PickerSelectProps<T extends AutocompleteItem> {
	/** Results to display in the picker */
	results: T[]
	/** Currently selected index */
	selectedIndex: number
	/** Maximum number of visible items */
	maxVisible?: number
	/** Called when an item is selected */
	onSelect: (item: T) => void
	/** Called when escape is pressed */
	onEscape: () => void
	/** Called when selection index changes */
	onIndexChange: (index: number) => void
	/** Render function for each item */
	renderItem: (item: T, isSelected: boolean) => ReactNode
	/** Message shown when results are empty */
	emptyMessage?: string
	/** Whether the picker accepts keyboard input */
	isActive?: boolean
	/** Whether search is in progress */
	isLoading?: boolean
}

/**
 * Compute visible window based on selected index.
 * The window "follows" the selection, keeping it visible.
 * Uses a ref to track the previous window position for smooth scrolling.
 */
function computeVisibleWindow(
	selectedIndex: number,
	totalItems: number,
	maxVisible: number,
	prevWindow: { from: number; to: number },
): { from: number; to: number } {
	if (totalItems === 0) {
		return { from: 0, to: 0 }
	}

	const visibleCount = Math.min(maxVisible, totalItems)

	// If previous window was empty (fresh results), compute initial window
	// This handles the case when results first appear
	if (prevWindow.to === 0 || prevWindow.to <= prevWindow.from) {
		const newFrom = Math.max(0, selectedIndex)
		const newTo = Math.min(totalItems, newFrom + visibleCount)
		return { from: newFrom, to: newTo }
	}

	// If selected index is within current window, keep the window
	if (selectedIndex >= prevWindow.from && selectedIndex < prevWindow.to) {
		// But clamp the window to valid bounds (in case totalItems changed)
		const clampedFrom = Math.max(0, Math.min(prevWindow.from, totalItems - visibleCount))
		const clampedTo = Math.min(totalItems, clampedFrom + visibleCount)
		return { from: clampedFrom, to: clampedTo }
	}

	// If selected is below window, scroll down to show it at bottom
	if (selectedIndex >= prevWindow.to) {
		const newTo = Math.min(totalItems, selectedIndex + 1)
		const newFrom = Math.max(0, newTo - visibleCount)
		return { from: newFrom, to: newTo }
	}

	// If selected is above window, scroll up to show it at top
	if (selectedIndex < prevWindow.from) {
		const newFrom = Math.max(0, selectedIndex)
		const newTo = Math.min(totalItems, newFrom + visibleCount)
		return { from: newFrom, to: newTo }
	}

	return prevWindow
}

/**
 * Generic picker dropdown component for autocomplete.
 * Uses windowing approach (like @inkjs/ui) - only renders visible items.
 * This eliminates flickering caused by ScrollArea's margin-based scrolling.
 *
 * @template T - The type of items to display
 */
export function PickerSelect<T extends AutocompleteItem>({
	results,
	selectedIndex,
	maxVisible = 10,
	onSelect,
	onEscape,
	onIndexChange,
	renderItem,
	emptyMessage = "No results found",
	isActive = true,
	isLoading = false,
}: PickerSelectProps<T>) {
	// Track previous window position for smooth scrolling
	const prevWindowRef = useRef({ from: 0, to: Math.min(maxVisible, results.length) })

	// Compute visible window SYNCHRONOUSLY during render (no state, no useEffect)
	// This ensures the correct items are rendered in a single pass
	const visibleWindow = useMemo(() => {
		const window = computeVisibleWindow(selectedIndex, results.length, maxVisible, prevWindowRef.current)
		// Update ref for next render
		prevWindowRef.current = window
		return window
	}, [selectedIndex, results.length, maxVisible])

	// Handle keyboard input
	useInput(
		(_input, key) => {
			if (!isActive) {
				return
			}

			if (key.escape) {
				onEscape()
				return
			}

			if (key.return) {
				const selected = results[selectedIndex]
				if (selected) {
					onSelect(selected)
				}
				return
			}

			if (key.upArrow) {
				const newIndex = selectedIndex > 0 ? selectedIndex - 1 : results.length - 1
				onIndexChange(newIndex)
				return
			}

			if (key.downArrow) {
				const newIndex = selectedIndex < results.length - 1 ? selectedIndex + 1 : 0
				onIndexChange(newIndex)
				return
			}
		},
		{ isActive },
	)

	// Compute visible items (the key optimization - only render what's visible)
	const visibleItems = useMemo(() => {
		return results.slice(visibleWindow.from, visibleWindow.to)
	}, [results, visibleWindow.from, visibleWindow.to])

	// Empty state - maintain consistent height
	if (results.length === 0) {
		const message = isLoading ? "Searching..." : emptyMessage
		return (
			<Box paddingLeft={2} height={maxVisible}>
				<Text dimColor>{message}</Text>
			</Box>
		)
	}

	// Calculate if we need scroll indicators
	const hasMoreAbove = visibleWindow.from > 0
	const hasMoreBelow = visibleWindow.to < results.length

	// Render only visible items (windowing approach)
	return (
		<Box flexDirection="column" height={maxVisible}>
			{/* Scroll indicator - more items above */}
			{hasMoreAbove && (
				<Box paddingLeft={2}>
					<Text dimColor>↑ {visibleWindow.from} more</Text>
				</Box>
			)}

			{/* Visible items */}
			{visibleItems.map((result, visibleIndex) => {
				const actualIndex = visibleWindow.from + visibleIndex
				const isSelected = actualIndex === selectedIndex
				return <Box key={result.key}>{renderItem(result, isSelected)}</Box>
			})}

			{/* Scroll indicator - more items below */}
			{hasMoreBelow && (
				<Box paddingLeft={2}>
					<Text dimColor>↓ {results.length - visibleWindow.to} more</Text>
				</Box>
			)}
		</Box>
	)
}
