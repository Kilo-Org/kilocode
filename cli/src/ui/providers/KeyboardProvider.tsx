/**
 * KeyboardProvider - Centralized keyboard event handling provider
 * Sets up raw mode, captures all keyboard input, and broadcasts events via Jotai
 * Automatically detects and enables Kitty keyboard protocol if supported
 */

import React, { useEffect, useRef, useCallback } from "react"
import { useSetAtom, useAtomValue } from "jotai"
import { useStdin } from "ink"
import readline from "node:readline"
import { PassThrough } from "node:stream"
import type { KeyboardProviderConfig } from "../../types/keyboard.js"
import { logs } from "../../services/logs.js"
import {
	broadcastKeyEventAtom,
	setPasteModeAtom,
	appendToPasteBufferAtom,
	pasteBufferAtom,
	setDragModeAtom,
	appendToDragBufferAtom,
	dragBufferAtom,
	kittyProtocolEnabledAtom,
	setKittyProtocolAtom,
	debugKeystrokeLoggingAtom,
	setDebugLoggingAtom,
	clearBuffersAtom,
	setupKeyboardAtom,
} from "../../state/atoms/keyboard.js"
import {
	parseReadlineKey,
	createPasteKey,
	createSpecialKey,
	isPasteModeBoundary,
	isFocusEvent,
	mapAltKeyCharacter,
	isDragStart,
} from "../../utils/keyboard/parsing.js"
import {
	autoEnableKittyProtocol,
	disableKittyProtocol,
	detectFallbackSupport,
} from "../../utils/keyboard/terminalCapabilities.js"
import {
	ESC,
	PASTE_MODE_PREFIX,
	PASTE_MODE_SUFFIX,
	BACKSLASH,
	BACKSLASH_ENTER_DETECTION_WINDOW_MS,
	DRAG_COMPLETION_TIMEOUT_MS,
} from "../../constants/keyboard/index.js"
import { createTimerManager } from "../../utils/keyboard/timerManager.js"
import { isShiftEnterSequence, normalizeLineEndings } from "../../utils/keyboard/helpers.js"
import {
	createFallbackPasteState,
	processFallbackPasteKey,
	completeFallbackPaste,
} from "../../utils/keyboard/pasteDetection.js"
import { createKittyBufferState, handleKittySequence, clearKittyBuffer } from "../../utils/keyboard/kitty.js"

interface KeyboardProviderProps {
	children: React.ReactNode
	config?: KeyboardProviderConfig
}

export function KeyboardProvider({ children, config = {} }: KeyboardProviderProps) {
	const { debugKeystrokeLogging = false, escapeCodeTimeout = 0 } = config

	// Get stdin and raw mode control
	const { stdin, setRawMode } = useStdin()

	// Jotai setters
	const broadcastKey = useSetAtom(broadcastKeyEventAtom)
	const setPasteMode = useSetAtom(setPasteModeAtom)
	const appendToPasteBuffer = useSetAtom(appendToPasteBufferAtom)
	const setDragMode = useSetAtom(setDragModeAtom)
	const appendToDragBuffer = useSetAtom(appendToDragBufferAtom)
	const setKittyProtocol = useSetAtom(setKittyProtocolAtom)
	const setDebugLogging = useSetAtom(setDebugLoggingAtom)
	const clearBuffers = useSetAtom(clearBuffersAtom)
	const setupKeyboard = useSetAtom(setupKeyboardAtom)

	// Jotai getters (for reading current state)
	const pasteBuffer = useAtomValue(pasteBufferAtom)
	const dragBuffer = useAtomValue(dragBufferAtom)
	const isKittyEnabled = useAtomValue(kittyProtocolEnabledAtom)
	const isDebugEnabled = useAtomValue(debugKeystrokeLoggingAtom)

	// Local refs for mutable state
	const isPasteRef = useRef(false)
	const pasteBufferRef = useRef<string>("")
	const isDraggingRef = useRef(false)
	const waitingForEnterRef = useRef(false)

	// Timer managers
	const dragTimerRef = useRef(createTimerManager())
	const backslashTimerRef = useRef(createTimerManager())
	const fallbackPasteTimerRef = useRef(createTimerManager())

	// Fallback paste detection state
	const fallbackPasteStateRef = useRef(createFallbackPasteState())

	// Kitty protocol state
	const kittyBufferStateRef = useRef(createKittyBufferState())

	// Update debug logging atom
	useEffect(() => {
		setDebugLogging(debugKeystrokeLogging)
	}, [debugKeystrokeLogging, setDebugLogging])

	// Complete paste
	const completePaste = useCallback(() => {
		const currentBuffer = pasteBufferRef.current
		if (isPasteRef.current && currentBuffer) {
			const normalizedBuffer = normalizeLineEndings(currentBuffer)
			broadcastKey(createPasteKey(normalizedBuffer))
			setPasteMode(false)
			isPasteRef.current = false
			pasteBufferRef.current = ""
		}
	}, [broadcastKey, setPasteMode])

	// Complete drag
	const completeDrag = useCallback(() => {
		if (isDraggingRef.current && dragBuffer) {
			broadcastKey(createPasteKey(dragBuffer))
			setDragMode(false)
			isDraggingRef.current = false
		}
		dragTimerRef.current.clear()
	}, [dragBuffer, broadcastKey, setDragMode])

	useEffect(() => {
		// Save original raw mode state
		const wasRaw = stdin.isRaw
		let kittyEnabled = false

		// Detect Fallback Paste Support
		const requiresFallback = detectFallbackSupport()

		// Setup centralized keyboard handler first
		const unsubscribeKeyboard = setupKeyboard()

		// Async initialization
		const init = async () => {
			if (!wasRaw) {
				setRawMode(true)
			}

			// Enable bracketed paste mode
			if (!requiresFallback) {
				process.stdout.write("\x1b[?2004h")
			}

			// Auto-detect and enable Kitty protocol if supported
			kittyEnabled = await autoEnableKittyProtocol()
			if (debugKeystrokeLogging) {
				logs.debug(`Kitty protocol: ${kittyEnabled ? "enabled" : "not supported"}`, "KeyboardProvider")
			}

			// Update atom with actual state
			setKittyProtocol(kittyEnabled)
		}

		init()

		// Setup streams
		const keypressStream = requiresFallback ? new PassThrough() : stdin
		const rl = readline.createInterface({
			input: keypressStream,
			escapeCodeTimeout,
		})

		// Enable keypress events
		readline.emitKeypressEvents(keypressStream, rl)

		// Handle keypress events from readline
		const handleKeypress = (_: unknown, key: any) => {
			if (!key) return

			// Parse the key
			const parsedKey = parseReadlineKey(key)

			if (isDebugEnabled) {
				logs.debug("Keypress", "KeyboardProvider", { parsedKey })
			}

			// Fallback paste detection for terminals like VSCode
			if (requiresFallback) {
				const wasHandled = processFallbackPasteKey(
					parsedKey,
					fallbackPasteStateRef.current,
					fallbackPasteTimerRef.current,
					broadcastKey,
				)
				if (wasHandled) return
			}

			// Check for focus events
			const focus = isFocusEvent(parsedKey.sequence)
			if (focus.isFocusIn || focus.isFocusOut) {
				return // Ignore focus events
			}

			// Check for paste mode boundaries
			const paste = isPasteModeBoundary(parsedKey.sequence)
			if (paste.isStart) {
				isPasteRef.current = true
				pasteBufferRef.current = ""
				setPasteMode(true)
				return
			}
			if (paste.isEnd) {
				completePaste()
				return
			}

			// Handle paste mode
			if (isPasteRef.current) {
				if (!requiresFallback) {
					pasteBufferRef.current += parsedKey.sequence
					appendToPasteBuffer(parsedKey.sequence)
				}
				return
			}

			// Handle drag mode
			if (isDragStart(parsedKey.sequence) || isDraggingRef.current) {
				isDraggingRef.current = true
				appendToDragBuffer(parsedKey.sequence)

				dragTimerRef.current.set(() => {
					completeDrag()
				}, DRAG_COMPLETION_TIMEOUT_MS)
				return
			}

			// Check for Alt key characters (macOS)
			const mappedLetter = mapAltKeyCharacter(parsedKey.sequence)
			if (mappedLetter && !parsedKey.meta) {
				broadcastKey({
					...parsedKey,
					name: mappedLetter,
					meta: true,
				})
				return
			}

			// Handle backslash + Enter detection (for Shift+Enter fallback)
			if (parsedKey.name === "return" && waitingForEnterRef.current) {
				backslashTimerRef.current.clear()
				waitingForEnterRef.current = false
				broadcastKey({
					...parsedKey,
					shift: true, // Treat as Shift+Enter
				})
				return
			}

			// Check for Shift+Enter via escape sequence
			if (isShiftEnterSequence(parsedKey.sequence)) {
				broadcastKey({
					name: "return",
					ctrl: false,
					meta: false,
					shift: true,
					paste: false,
					sequence: parsedKey.sequence,
				})
				return
			}

			// Handle backslash detection
			if (parsedKey.sequence === BACKSLASH && !parsedKey.name) {
				waitingForEnterRef.current = true
				backslashTimerRef.current.set(() => {
					waitingForEnterRef.current = false
					broadcastKey(parsedKey)
				}, BACKSLASH_ENTER_DETECTION_WINDOW_MS)
				return
			}

			// If waiting for Enter but got something else, send backslash first
			if (waitingForEnterRef.current && parsedKey.name !== "return") {
				backslashTimerRef.current.clear()
				waitingForEnterRef.current = false
				broadcastKey(createSpecialKey("", BACKSLASH))
			}

			// Handle Kitty protocol sequences
			if (isKittyEnabled && parsedKey.sequence.startsWith(ESC)) {
				const keys = handleKittySequence(parsedKey.sequence, kittyBufferStateRef.current, isDebugEnabled)

				if (keys.length > 0) {
					keys.forEach((k) => broadcastKey(k))
					return
				}

				// If no keys parsed, wait for more data (unless buffer is empty)
				if (kittyBufferStateRef.current.buffer.length > 0) {
					return
				}
			}

			// Handle Ctrl+C specially
			if (parsedKey.ctrl && parsedKey.name === "c") {
				clearBuffers() // Clear all buffers on Ctrl+C
			}

			// Broadcast the key
			broadcastKey(parsedKey)
		}

		// Handle raw data for paste detection (if using passthrough)
		const handleRawData = (data: Buffer) => {
			if (!requiresFallback) return

			const dataStr = data.toString()
			let pos = 0

			while (pos < dataStr.length) {
				// Check for paste mode prefix
				const prefixPos = dataStr.indexOf(PASTE_MODE_PREFIX, pos)
				const suffixPos = dataStr.indexOf(PASTE_MODE_SUFFIX, pos)

				let nextMarkerPos = -1
				let isPrefixNext = false
				let isSuffixNext = false

				if (prefixPos !== -1 && (suffixPos === -1 || prefixPos < suffixPos)) {
					nextMarkerPos = prefixPos
					isPrefixNext = true
				} else if (suffixPos !== -1) {
					nextMarkerPos = suffixPos
					isSuffixNext = true
				}

				if (nextMarkerPos === -1) {
					// No more markers
					if (isPasteRef.current) {
						// We're in paste mode - accumulate the remaining data in paste buffer
						const chunk = dataStr.slice(pos)
						pasteBufferRef.current += chunk
						appendToPasteBuffer(chunk)
					} else {
						// Not in paste mode - write remaining data to stream
						keypressStream.write(data.slice(pos))
					}
					break
				}

				// Handle data before marker
				if (nextMarkerPos > pos) {
					if (isPasteRef.current) {
						// We're in paste mode - accumulate data in paste buffer
						const chunk = dataStr.slice(pos, nextMarkerPos)
						pasteBufferRef.current += chunk
						appendToPasteBuffer(chunk)
					} else {
						// Not in paste mode - write data to stream
						keypressStream.write(data.slice(pos, nextMarkerPos))
					}
				}

				// Handle marker
				if (isPrefixNext) {
					// Start paste mode
					isPasteRef.current = true
					pasteBufferRef.current = ""
					setPasteMode(true)
					pos = nextMarkerPos + PASTE_MODE_PREFIX.length
				} else if (isSuffixNext) {
					// End paste mode and complete the paste
					completePaste()
					pos = nextMarkerPos + PASTE_MODE_SUFFIX.length
				}
			}
		}

		// Setup event listeners
		keypressStream.on("keypress", handleKeypress)
		if (requiresFallback) {
			stdin.on("data", handleRawData)
		}

		// Cleanup
		return () => {
			keypressStream.removeListener("keypress", handleKeypress)
			if (requiresFallback) {
				stdin.removeListener("data", handleRawData)
			}
			rl.close()

			// Cleanup keyboard handler
			unsubscribeKeyboard()

			// Disable bracketed paste mode (only if it was enabled)
			if (!requiresFallback) {
				process.stdout.write("\x1b[?2004l")
			}

			// Disable Kitty keyboard protocol if it was enabled
			const currentKittyState = isKittyEnabled
			if (currentKittyState) {
				disableKittyProtocol()
			}

			// Restore original raw mode
			if (!wasRaw) {
				setRawMode(false)
			}

			// Clear timers
			dragTimerRef.current.clear()
			backslashTimerRef.current.clear()
			fallbackPasteTimerRef.current.clear()

			// Flush any pending buffers
			completePaste()
			completeDrag()
			completeFallbackPaste(fallbackPasteStateRef.current, (text) => {
				broadcastKey(createPasteKey(text))
			})
			clearBuffers()
			clearKittyBuffer(kittyBufferStateRef.current)
		}
	}, [
		stdin,
		setRawMode,
		escapeCodeTimeout,
		broadcastKey,
		setPasteMode,
		appendToPasteBuffer,
		setDragMode,
		appendToDragBuffer,
		clearBuffers,
		setKittyProtocol,
		pasteBuffer,
		dragBuffer,
		isKittyEnabled,
		isDebugEnabled,
		completePaste,
		completeDrag,
		setupKeyboard,
	])

	return <>{children}</>
}
