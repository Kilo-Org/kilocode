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
	appendToKittyBufferAtom,
	clearKittyBufferAtom,
	kittySequenceBufferAtom,
	kittyProtocolEnabledAtom,
	setKittyProtocolAtom,
	debugKeystrokeLoggingAtom,
	setDebugLoggingAtom,
	clearBuffersAtom,
	setupKeyboardAtom,
} from "../../state/atoms/keyboard.js"
import {
	parseKittySequence,
	isPasteModeBoundary,
	isFocusEvent,
	mapAltKeyCharacter,
	isDragStart,
	parseReadlineKey,
	createPasteKey,
	createSpecialKey,
} from "../utils/keyParsing.js"
import { autoEnableKittyProtocol, disableKittyProtocol, detectFallbackSupport } from "../utils/terminalCapabilities.js"
import {
	ESC,
	PASTE_MODE_PREFIX,
	PASTE_MODE_SUFFIX,
	BACKSLASH,
	BACKSLASH_ENTER_DETECTION_WINDOW_MS,
	DRAG_COMPLETION_TIMEOUT_MS,
	MAX_KITTY_SEQUENCE_LENGTH,
} from "../../constants/keyboard/index.js"

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
	const appendToKittyBuffer = useSetAtom(appendToKittyBufferAtom)
	const clearKittyBuffer = useSetAtom(clearKittyBufferAtom)
	const setKittyProtocol = useSetAtom(setKittyProtocolAtom)
	const setDebugLogging = useSetAtom(setDebugLoggingAtom)
	const clearBuffers = useSetAtom(clearBuffersAtom)
	const setupKeyboard = useSetAtom(setupKeyboardAtom)

	// Jotai getters (for reading current state)
	const pasteBuffer = useAtomValue(pasteBufferAtom)
	const dragBuffer = useAtomValue(dragBufferAtom)
	const kittyBuffer = useAtomValue(kittySequenceBufferAtom)
	const isKittyEnabled = useAtomValue(kittyProtocolEnabledAtom)
	const isDebugEnabled = useAtomValue(debugKeystrokeLoggingAtom)

	// Local refs for mutable state
	const isPasteRef = useRef(false)
	const pasteBufferRef = useRef<string>("")
	const isDraggingRef = useRef(false)
	const dragTimerRef = useRef<NodeJS.Timeout | null>(null)
	const backslashTimerRef = useRef<NodeJS.Timeout | null>(null)
	const waitingForEnterRef = useRef(false)

	// Fallback paste detection refs
	const fallbackPasteTimerRef = useRef<NodeJS.Timeout | null>(null)
	const fallbackPasteBufferRef = useRef<string>("")
	const isFallbackPastingRef = useRef(false)
	const lastKeypressTimeRef = useRef<number>(0)

	// Update debug logging atom
	useEffect(() => {
		setDebugLogging(debugKeystrokeLogging)
	}, [debugKeystrokeLogging, setDebugLogging])

	// Clear drag timer
	const clearDragTimer = useCallback(() => {
		if (dragTimerRef.current) {
			clearTimeout(dragTimerRef.current)
			dragTimerRef.current = null
		}
	}, [])

	// Clear backslash timer
	const clearBackslashTimer = useCallback(() => {
		if (backslashTimerRef.current) {
			clearTimeout(backslashTimerRef.current)
			backslashTimerRef.current = null
		}
	}, [])

	// Clear fallback paste timer
	const clearFallbackPasteTimer = useCallback(() => {
		if (fallbackPasteTimerRef.current) {
			clearTimeout(fallbackPasteTimerRef.current)
			fallbackPasteTimerRef.current = null
		}
	}, [])

	// Complete fallback paste
	const completeFallbackPaste = useCallback(() => {
		if (isFallbackPastingRef.current && fallbackPasteBufferRef.current) {
			if (isDebugEnabled) {
				logs.debug(
					`Fallback paste completed: ${fallbackPasteBufferRef.current.length} chars, ${fallbackPasteBufferRef.current.split("\n").length} lines`,
					"KeyboardProvider",
				)
			}
			const normalizedBuffer = fallbackPasteBufferRef.current.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
			broadcastKey(createPasteKey(normalizedBuffer))
			isFallbackPastingRef.current = false
			fallbackPasteBufferRef.current = ""
		}
		clearFallbackPasteTimer()
	}, [broadcastKey, clearFallbackPasteTimer, isDebugEnabled])

	// Handle paste completion
	const completePaste = useCallback(() => {
		const currentBuffer = pasteBufferRef.current
		if (isPasteRef.current && currentBuffer) {
			// Normalize line endings: convert \r\n and \r to \n
			// This handles different line ending formats from various terminals/platforms
			const normalizedBuffer = currentBuffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
			broadcastKey(createPasteKey(normalizedBuffer))
			setPasteMode(false)
			isPasteRef.current = false
			pasteBufferRef.current = ""
		}
	}, [broadcastKey, setPasteMode])

	// Handle drag completion
	const completeDrag = useCallback(() => {
		if (isDraggingRef.current && dragBuffer) {
			broadcastKey(createPasteKey(dragBuffer))
			setDragMode(false)
			isDraggingRef.current = false
		}
		clearDragTimer()
	}, [dragBuffer, broadcastKey, setDragMode, clearDragTimer])

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

			// Fallback support for terminals like VSCode
			// Only trigger on newlines followed by rapid input (the specific paste problem)
			if (requiresFallback) {
				const now = Date.now()
				const timeSinceLastKey = now - lastKeypressTimeRef.current

				// Check if this is a navigation key that should never trigger paste detection
				const isNavigationKey =
					parsedKey.name &&
					[
						"up",
						"down",
						"left",
						"right",
						"home",
						"end",
						"pageup",
						"pagedown",
						"tab",
						"escape",
						"backspace",
						"delete",
						"f1",
						"f2",
						"f3",
						"f4",
						"f5",
						"f6",
						"f7",
						"f8",
						"f9",
						"f10",
						"f11",
						"f12",
					].includes(parsedKey.name)

				// If we're already in paste mode, continue accumulating
				if (isFallbackPastingRef.current) {
					fallbackPasteBufferRef.current += parsedKey.sequence

					// Reset timer - wait for input to stop
					clearFallbackPasteTimer()
					fallbackPasteTimerRef.current = setTimeout(() => {
						completeFallbackPaste()
					}, 100)

					return // Don't process this key normally
				}

				// Check if this is a newline/return key
				const isNewline =
					parsedKey.name === "return" ||
					parsedKey.sequence === "\n" ||
					parsedKey.sequence === "\r" ||
					parsedKey.sequence === "\r\n"

				// Only start paste detection on newline with rapid subsequent input
				// Ignore navigation keys completely - they should never trigger paste mode
				if (!isNavigationKey && isNewline && timeSinceLastKey <= 20) {
					// Rapid newline - likely start of multiline paste
					isFallbackPastingRef.current = true
					fallbackPasteBufferRef.current = parsedKey.sequence

					// Set timer to complete paste if no more input arrives
					clearFallbackPasteTimer()
					fallbackPasteTimerRef.current = setTimeout(() => {
						completeFallbackPaste()
					}, 100)

					return // Don't process this key normally
				}

				// Update last keypress time only for non-navigation keys
				// This prevents arrow key repeats from affecting timing
				if (!isNavigationKey) {
					lastKeypressTimeRef.current = now
				}
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

			// Handle paste mode - when using passthrough, paste content is handled in handleRawData
			// When not using passthrough, we still need to accumulate here
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

				clearDragTimer()
				dragTimerRef.current = setTimeout(() => {
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
				clearBackslashTimer()
				waitingForEnterRef.current = false
				broadcastKey({
					...parsedKey,
					shift: true, // Treat as Shift+Enter
				})
				return
			}

			// Check for Shift+Enter via escape sequence
			// Some terminals send ESC + Enter for Shift+Enter
			if (parsedKey.sequence === `${ESC}\r` || parsedKey.sequence === `${ESC}\n`) {
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

			if (parsedKey.sequence === BACKSLASH && !parsedKey.name) {
				waitingForEnterRef.current = true
				backslashTimerRef.current = setTimeout(() => {
					waitingForEnterRef.current = false
					broadcastKey(parsedKey)
				}, BACKSLASH_ENTER_DETECTION_WINDOW_MS)
				return
			}

			if (waitingForEnterRef.current && parsedKey.name !== "return") {
				clearBackslashTimer()
				waitingForEnterRef.current = false
				// Send the backslash first
				broadcastKey(createSpecialKey("", BACKSLASH))
			}

			// Handle Kitty protocol sequences
			if (isKittyEnabled && parsedKey.sequence.startsWith(ESC)) {
				// Try to parse the sequence directly first
				const result = parseKittySequence(parsedKey.sequence)

				if (result.key) {
					// Successfully parsed immediately
					if (isDebugEnabled) {
						logs.debug("Kitty sequence parsed", "KeyboardProvider", { key: result.key })
					}
					broadcastKey(result.key)
					return
				}

				// If not parsed, accumulate in buffer
				appendToKittyBuffer(parsedKey.sequence)

				// Try to parse accumulated buffer
				let buffer = kittyBuffer + parsedKey.sequence
				let parsedAny = false

				while (buffer) {
					const bufferResult = parseKittySequence(buffer)
					if (!bufferResult.key) {
						// Look for next CSI start
						const nextStart = buffer.indexOf(ESC, 1)
						if (nextStart > 0) {
							if (isDebugEnabled) {
								logs.debug("Skipping incomplete sequence, looking for next CSI", "KeyboardProvider")
							}
							buffer = buffer.slice(nextStart)
							continue
						}
						break
					}

					// Successfully parsed a key
					if (isDebugEnabled) {
						logs.debug("Kitty buffer parsed", "KeyboardProvider", { key: bufferResult.key })
					}
					buffer = buffer.slice(bufferResult.consumedLength)
					broadcastKey(bufferResult.key)
					parsedAny = true
				}

				if (parsedAny) {
					clearKittyBuffer()
					if (buffer) {
						appendToKittyBuffer(buffer)
					}
					return
				}

				// Check for buffer overflow
				if (kittyBuffer.length > MAX_KITTY_SEQUENCE_LENGTH) {
					if (isDebugEnabled) {
						logs.warn("Kitty buffer overflow, clearing", "KeyboardProvider", { kittyBuffer })
					}
					clearKittyBuffer()
				} else {
					return // Wait for more data
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
			clearDragTimer()
			clearBackslashTimer()
			clearFallbackPasteTimer()

			// Flush any pending buffers
			completePaste()
			completeDrag()
			completeFallbackPaste()
			clearBuffers()
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
		appendToKittyBuffer,
		clearKittyBuffer,
		clearBuffers,
		setKittyProtocol,
		pasteBuffer,
		dragBuffer,
		kittyBuffer,
		isKittyEnabled,
		isDebugEnabled,
		completePaste,
		completeDrag,
		clearDragTimer,
		clearBackslashTimer,
		clearFallbackPasteTimer,
		completeFallbackPaste,
		setupKeyboard,
	])

	return <>{children}</>
}
