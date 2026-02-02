import { useEffect, useRef } from "react"
import { useInput } from "ink"
import type { WebviewMessage } from "@roo-code/types"

import { matchesGlobalSequence } from "@/lib/utils/input.js"

import type { ModeResult } from "../components/autocomplete/index.js"
import { useUIStateStore } from "../stores/uiStateStore.js"
import { useCLIStore } from "../store.js"

export interface UseGlobalInputOptions {
	canToggleFocus: boolean
	isScrollAreaActive: boolean
	pickerIsOpen: boolean
	availableModes: ModeResult[]
	currentMode: string | null
	mode: string
	sendToExtension: ((msg: WebviewMessage) => void) | null
	showInfo: (msg: string, duration?: number) => void
	exit: () => void
	cleanup: () => Promise<void>
	toggleFocus: () => void
	closePicker: () => void
}

/**
 * Hook to handle global keyboard shortcuts.
 *
 * Shortcuts:
 * - Ctrl+C: Double-press to exit
 * - Tab: Toggle focus between scroll area and input
 * - Ctrl+M: Cycle through available modes
 * - Ctrl+T: Toggle TODO list viewer
 * - Escape: Cancel task (when loading) or close TODO viewer
 */
export function useGlobalInput({
	canToggleFocus,
	isScrollAreaActive: _isScrollAreaActive,
	pickerIsOpen,
	availableModes,
	currentMode,
	mode,
	sendToExtension,
	showInfo,
	exit,
	cleanup,
	toggleFocus,
	closePicker,
}: UseGlobalInputOptions): void {
	const { isLoading, currentTodos } = useCLIStore()
	const {
		showTodoViewer,
		setShowTodoViewer,
		showExitHint: _showExitHint,
		setShowExitHint,
		pendingExit,
		setPendingExit,
	} = useUIStateStore()

	// Track Ctrl+C presses for "press again to exit" behavior
	const exitHintTimeout = useRef<NodeJS.Timeout | null>(null)

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (exitHintTimeout.current) {
				clearTimeout(exitHintTimeout.current)
			}
		}
	}, [])

	// Handle global keyboard shortcuts
	useInput((input, key) => {
		// Tab to toggle focus between scroll area and input (only when input is available)
		if (key.tab && canToggleFocus && !pickerIsOpen) {
			toggleFocus()
			return
		}

		// Ctrl+M to cycle through modes (only when not loading and we have available modes)
		// Uses centralized global input sequence detection
		if (matchesGlobalSequence(input, key, "ctrl-m")) {
			// Don't allow mode switching while a task is in progress (loading)
			if (isLoading) {
				showInfo("Cannot switch modes while task is in progress", 2000)
				return
			}

			// Need at least 2 modes to cycle
			if (availableModes.length < 2) {
				return
			}

			// Find current mode index
			const currentModeSlug = currentMode || mode
			const currentIndex = availableModes.findIndex((m) => m.slug === currentModeSlug)
			const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availableModes.length
			const nextMode = availableModes[nextIndex]

			if (nextMode && sendToExtension) {
				sendToExtension({ type: "mode", text: nextMode.slug })
				showInfo(`Switched to ${nextMode.name}`, 2000)
			}

			return
		}

		// Ctrl+T to toggle TODO list viewer
		if (matchesGlobalSequence(input, key, "ctrl-t")) {
			// Close picker if open
			if (pickerIsOpen) {
				closePicker()
			}
			// Toggle TODO viewer
			setShowTodoViewer(!showTodoViewer)
			if (!showTodoViewer && currentTodos.length === 0) {
				showInfo("No TODO list available", 2000)
				setShowTodoViewer(false)
			}
			return
		}

		// Escape key to close TODO viewer
		if (key.escape && showTodoViewer) {
			setShowTodoViewer(false)
			return
		}

		// Escape key to cancel/pause task when loading (streaming)
		if (key.escape && isLoading && sendToExtension) {
			// If picker is open, let the picker handle escape first
			if (pickerIsOpen) {
				return
			}
			// Send cancel message to extension (same as webview-ui Cancel button)
			sendToExtension({ type: "cancelTask" })
			return
		}

		// Ctrl+C to exit
		if (key.ctrl && input === "c") {
			// If picker is open, close it first
			if (pickerIsOpen) {
				closePicker()
				return
			}

			if (pendingExit) {
				// Second press - exit immediately
				if (exitHintTimeout.current) {
					clearTimeout(exitHintTimeout.current)
				}
				cleanup().finally(() => {
					exit()
					process.exit(0)
				})
			} else {
				// First press - show hint and wait for second press
				setPendingExit(true)
				setShowExitHint(true)

				exitHintTimeout.current = setTimeout(() => {
					setPendingExit(false)
					setShowExitHint(false)
					exitHintTimeout.current = null
				}, 2000)
			}
		}
	})
}
