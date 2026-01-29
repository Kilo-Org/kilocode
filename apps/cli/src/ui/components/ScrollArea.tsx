import { Box, DOMElement, measureElement, Text, useInput } from "ink"
import { useEffect, useReducer, useRef, useCallback, useMemo, useState } from "react"

import * as theme from "../theme.js"

interface ScrollAreaState {
	innerHeight: number
	height: number
	scrollTop: number
	autoScroll: boolean
}

function calculateScrollbar(
	viewportHeight: number,
	contentHeight: number,
	scrollTop: number,
): { handleStart: number; handleHeight: number; maxScroll: number } {
	const maxScroll = Math.max(0, contentHeight - viewportHeight)

	if (contentHeight <= viewportHeight || maxScroll === 0) {
		// No scrolling needed - handle fills entire track
		return { handleStart: 0, handleHeight: viewportHeight, maxScroll: 0 }
	}

	// Calculate handle height as ratio of viewport to content (minimum 1 line)
	const handleHeight = Math.max(1, Math.round((viewportHeight / contentHeight) * viewportHeight))

	// Calculate handle position
	const trackSpace = viewportHeight - handleHeight
	const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0
	const handleStart = Math.round(scrollRatio * trackSpace)

	return { handleStart, handleHeight, maxScroll }
}

type ScrollAreaAction =
	| { type: "SET_INNER_HEIGHT"; innerHeight: number }
	| { type: "SET_HEIGHT"; height: number }
	| { type: "SCROLL_DOWN"; amount?: number }
	| { type: "SCROLL_UP"; amount?: number }
	| { type: "SCROLL_TO_BOTTOM" }
	| { type: "SCROLL_TO_LINE"; line: number }
	| { type: "SET_AUTO_SCROLL"; autoScroll: boolean }

function reducer(state: ScrollAreaState, action: ScrollAreaAction): ScrollAreaState {
	const maxScroll = Math.max(0, state.innerHeight - state.height)

	switch (action.type) {
		case "SET_INNER_HEIGHT": {
			const newMaxScroll = Math.max(0, action.innerHeight - state.height)
			// If auto-scroll is enabled and content grew, scroll to bottom
			if (state.autoScroll && action.innerHeight > state.innerHeight) {
				return {
					...state,
					innerHeight: action.innerHeight,
					scrollTop: newMaxScroll,
				}
			}
			// Clamp scrollTop to valid range
			return {
				...state,
				innerHeight: action.innerHeight,
				scrollTop: Math.min(state.scrollTop, newMaxScroll),
			}
		}

		case "SET_HEIGHT": {
			const newMaxScroll = Math.max(0, state.innerHeight - action.height)
			// If auto-scroll is enabled, stay at bottom
			if (state.autoScroll) {
				return {
					...state,
					height: action.height,
					scrollTop: newMaxScroll,
				}
			}
			// Clamp scrollTop to valid range
			return {
				...state,
				height: action.height,
				scrollTop: Math.min(state.scrollTop, newMaxScroll),
			}
		}

		case "SCROLL_DOWN": {
			const amount = action.amount || 1
			const newScrollTop = Math.min(maxScroll, state.scrollTop + amount)
			// If we scroll to the bottom, re-enable auto-scroll
			const atBottom = newScrollTop >= maxScroll
			return {
				...state,
				scrollTop: newScrollTop,
				autoScroll: atBottom,
			}
		}

		case "SCROLL_UP": {
			const amount = action.amount || 1
			const newScrollTop = Math.max(0, state.scrollTop - amount)
			// Disable auto-scroll when user scrolls up
			return {
				...state,
				scrollTop: newScrollTop,
				autoScroll: newScrollTop >= maxScroll,
			}
		}

		case "SCROLL_TO_BOTTOM":
			return {
				...state,
				scrollTop: maxScroll,
				autoScroll: true,
			}

		case "SCROLL_TO_LINE": {
			// Scroll to make a specific line visible
			// If line is above viewport, scroll up to show it at the top
			// If line is below viewport, scroll down to show it at the bottom
			const line = action.line
			const viewportBottom = state.scrollTop + state.height - 1

			if (line < state.scrollTop) {
				// Line is above viewport - scroll up to show it at the top
				return {
					...state,
					scrollTop: Math.max(0, line),
					autoScroll: false,
				}
			} else if (line > viewportBottom) {
				// Line is below viewport - scroll down to show it at the bottom
				const newScrollTop = Math.min(maxScroll, line - state.height + 1)
				return {
					...state,
					scrollTop: newScrollTop,
					autoScroll: newScrollTop >= maxScroll,
				}
			}
			// Line is already visible - no change needed
			return state
		}

		case "SET_AUTO_SCROLL":
			return {
				...state,
				autoScroll: action.autoScroll,
				scrollTop: action.autoScroll ? maxScroll : state.scrollTop,
			}

		default:
			return state
	}
}

export interface ScrollAreaProps {
	height?: number
	children: React.ReactNode
	isActive?: boolean
	onScroll?: (scrollTop: number, maxScroll: number, isAtBottom: boolean) => void
	showBorder?: boolean
	scrollToBottomTrigger?: number
	scrollToLine?: number
	scrollToLineTrigger?: number
	showScrollbar?: boolean
	/** Whether to auto-scroll to bottom when content grows. Default: true */
	autoScroll?: boolean
}

export function ScrollArea({
	height: heightProp,
	children,
	isActive = true,
	onScroll,
	showBorder = false,
	scrollToBottomTrigger,
	scrollToLine,
	scrollToLineTrigger,
	showScrollbar = true,
	autoScroll: autoScrollProp = true,
}: ScrollAreaProps) {
	// Ref for measuring outer container height when not provided
	const outerRef = useRef<DOMElement>(null)
	const [measuredHeight, setMeasuredHeight] = useState(0)

	// Use provided height or measured height
	const height = heightProp ?? measuredHeight

	const [state, dispatch] = useReducer(reducer, {
		height: height,
		scrollTop: 0,
		innerHeight: 0,
		autoScroll: autoScrollProp,
	})

	const innerRef = useRef<DOMElement>(null)
	const lastMeasuredHeight = useRef<number>(0)
	// Track previous scrollToLineTrigger to detect actual changes (allows scrolling to index 0)
	const prevScrollToLineTriggerRef = useRef<number | undefined>(undefined)

	// Update height when prop changes
	useEffect(() => {
		if (height > 0) {
			dispatch({ type: "SET_HEIGHT", height })
		}
	}, [height])

	// Measure outer container height when no height prop is provided
	useEffect(() => {
		if (heightProp !== undefined) return // Skip if height is provided

		const measureOuter = () => {
			if (!outerRef.current) return
			const dimensions = measureElement(outerRef.current)
			if (dimensions.height !== measuredHeight && dimensions.height > 0) {
				setMeasuredHeight(dimensions.height)
			}
		}

		// Initial measurement
		measureOuter()

		// Re-measure periodically to catch layout changes
		const interval = setInterval(measureOuter, 100)

		return () => {
			clearInterval(interval)
		}
	}, [heightProp, measuredHeight])

	// Scroll to bottom when trigger changes
	useEffect(() => {
		if (scrollToBottomTrigger !== undefined && scrollToBottomTrigger > 0) {
			dispatch({ type: "SCROLL_TO_BOTTOM" })
		}
	}, [scrollToBottomTrigger])

	// Scroll to specific line when trigger changes
	// FIX: Use ref to detect actual changes instead of `> 0` check, which broke scrolling to index 0
	useEffect(() => {
		const prevTrigger = prevScrollToLineTriggerRef.current
		const triggerChanged = scrollToLineTrigger !== prevTrigger

		// Only dispatch if trigger actually changed and we have valid values
		// This allows scrolling to index 0 (which was broken by the old `> 0` check)
		if (triggerChanged && scrollToLineTrigger !== undefined && scrollToLine !== undefined) {
			dispatch({ type: "SCROLL_TO_LINE", line: scrollToLine })
		}

		// Update the ref to track the current trigger value
		prevScrollToLineTriggerRef.current = scrollToLineTrigger
	}, [scrollToLineTrigger, scrollToLine])

	// Measure inner content height - use MutationObserver pattern for dynamic content
	useEffect(() => {
		if (!innerRef.current) return

		const measureAndUpdate = () => {
			if (!innerRef.current) return
			const dimensions = measureElement(innerRef.current)
			if (dimensions.height !== lastMeasuredHeight.current) {
				lastMeasuredHeight.current = dimensions.height
				dispatch({ type: "SET_INNER_HEIGHT", innerHeight: dimensions.height })
			}
		}

		// Initial measurement
		measureAndUpdate()

		// Re-measure periodically while component is mounted
		// This handles streaming content that changes size
		const interval = setInterval(measureAndUpdate, 100)

		return () => {
			clearInterval(interval)
		}
	}, [children])

	// Notify parent of scroll changes
	useEffect(() => {
		if (onScroll) {
			const maxScroll = Math.max(0, state.innerHeight - state.height)
			const isAtBottom = state.scrollTop >= maxScroll || maxScroll === 0
			onScroll(state.scrollTop, maxScroll, isAtBottom)
		}
	}, [state.scrollTop, state.innerHeight, state.height, onScroll])

	// Handle keyboard input for scrolling
	useInput(
		(_input, key) => {
			if (!isActive) return

			if (key.downArrow) {
				dispatch({ type: "SCROLL_DOWN" })
			}

			if (key.upArrow) {
				dispatch({ type: "SCROLL_UP" })
			}

			if (key.pageDown) {
				dispatch({ type: "SCROLL_DOWN", amount: Math.floor(state.height / 2) })
			}

			if (key.pageUp) {
				dispatch({ type: "SCROLL_UP", amount: Math.floor(state.height / 2) })
			}

			// Home - scroll to top
			if (key.ctrl && _input === "a") {
				dispatch({ type: "SCROLL_UP", amount: state.scrollTop })
			}

			// End - scroll to bottom
			if (key.ctrl && _input === "e") {
				dispatch({ type: "SCROLL_TO_BOTTOM" })
			}
		},
		{ isActive },
	)

	// Calculate scrollbar dimensions
	const scrollbar = useMemo(() => {
		return calculateScrollbar(state.height, state.innerHeight, state.scrollTop)
	}, [state.height, state.innerHeight, state.scrollTop])

	// Determine if scrollbar should be visible
	// Show scrollbar when: there's content to scroll, OR when focused (to indicate focus state)
	// Hide scrollbar only when: not focused AND nothing to scroll
	const showScrollbarVisible = showScrollbar && (scrollbar.maxScroll > 0 || isActive)

	// Scrollbar colors based on focus state
	// When active: handle is bright purple, track is muted
	// When inactive: handle is dim gray, track is more muted
	const handleColor = isActive ? theme.scrollActiveColor : theme.dimText
	const trackColor = theme.scrollTrackColor

	// When no height prop is provided, use flexGrow to fill available space
	const useFlexGrow = heightProp === undefined

	return (
		<Box
			ref={outerRef}
			flexDirection="row"
			height={useFlexGrow ? undefined : height}
			flexGrow={useFlexGrow ? 1 : undefined}
			flexShrink={useFlexGrow ? 1 : undefined}
			overflow="hidden">
			{/* Scroll content area */}
			<Box
				height={useFlexGrow ? undefined : height}
				borderStyle={showBorder ? "single" : undefined}
				flexDirection="column"
				flexGrow={1}
				flexShrink={1}
				overflow="hidden">
				<Box ref={innerRef} flexShrink={0} flexDirection="column" marginTop={-state.scrollTop}>
					{children}
				</Box>
			</Box>

			{/* Scrollbar - rendered with separate colors for handle and track */}
			{showScrollbar && (
				<Box flexDirection="column" width={1} flexShrink={0} overflow="hidden">
					{showScrollbarVisible &&
						height > 0 &&
						Array(height)
							.fill(null)
							.map((_, i) => {
								const isHandle =
									i >= scrollbar.handleStart && i < scrollbar.handleStart + scrollbar.handleHeight
								return (
									<Text key={i} color={isHandle ? handleColor : trackColor}>
										{isHandle ? "┃" : "│"}
									</Text>
								)
							})}
				</Box>
			)}
		</Box>
	)
}

/**
 * Hook to use with ScrollArea for external control
 */
export function useScrollToBottom() {
	const triggerRef = useRef(0)
	const [, forceUpdate] = useReducer((x) => x + 1, 0)

	const scrollToBottom = useCallback(() => {
		triggerRef.current += 1
		forceUpdate()
	}, [])

	return {
		scrollToBottomTrigger: triggerRef.current,
		scrollToBottom,
	}
}
