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
import type { Key, KeyboardProviderConfig } from "../../types/keypress.js"
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
	waitingForEnterAfterBackslashAtom,
} from "../../state/atoms/keypress.js"
import {
	parseKittySequence,
	parseLegacySequence,
	isPasteModeBoundary,
	isFocusEvent,
	mapAltKeyCharacter,
	isDragStart,
	parseReadlineKey,
	createPasteKey,
	createSpecialKey,
} from "../utils/keyParsing.js"
import { autoEnableKittyProtocol, disableKittyProtocol } from "../utils/terminalCapabilities.js"
import {
	ESC,
	PASTE_MODE_PREFIX,
	PASTE_MODE_SUFFIX,
	FOCUS_IN,
	FOCUS_OUT,
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

	// Jotai getters (for reading current state)
	const pasteBuffer = useAtomValue(pasteBufferAtom)
	const dragBuffer = useAtomValue(dragBufferAtom)
	const kittyBuffer = useAtomValue(kittySequenceBufferAtom)
	const isKittyEnabled = useAtomValue(kittyProtocolEnabledAtom)
	const isDebugEnabled = useAtomValue(debugKeystrokeLoggingAtom)
	const waitingForEnter = useAtomValue(waitingForEnterAfterBackslashAtom)

	// Local refs for mutable state
	const isPasteRef = useRef(false)
	const isDraggingRef = useRef(false)
	const dragTimerRef = useRef<NodeJS.Timeout | null>(null)
	const backslashTimerRef = useRef<NodeJS.Timeout | null>(null)
	const waitingForEnterRef = useRef(false)

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

	// Handle paste completion
	const completePaste = useCallback(() => {
		if (isPasteRef.current && pasteBuffer) {
			broadcastKey(createPasteKey(pasteBuffer))
			setPasteMode(false)
			isPasteRef.current = false
		}
	}, [pasteBuffer, broadcastKey, setPasteMode])

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

		// Async initialization
		const init = async () => {
			if (!wasRaw) {
				setRawMode(true)
			}

			// Auto-detect and enable Kitty protocol if supported
			kittyEnabled = await autoEnableKittyProtocol()
			if (debugKeystrokeLogging) {
				console.log(`[DEBUG] Kitty protocol: ${kittyEnabled ? "enabled" : "not supported"}`)
			}

			// Update atom with actual state
			setKittyProtocol(kittyEnabled)
		}

		init()

		// Determine if we need a passthrough stream (for older Node versions or paste workaround)
		const nodeVersionParts = process.versions.node.split(".")
		const nodeMajorVersion = nodeVersionParts[0] ? parseInt(nodeVersionParts[0], 10) : 20
		const usePassthrough =
			nodeMajorVersion < 20 ||
			process.env["PASTE_WORKAROUND"] === "1" ||
			process.env["PASTE_WORKAROUND"] === "true"

		// Setup streams
		const keypressStream = usePassthrough ? new PassThrough() : stdin
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
				console.log("[DEBUG] Keypress:", parsedKey)
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
				setPasteMode(true)
				return
			}
			if (paste.isEnd) {
				completePaste()
				return
			}

			// Handle paste mode
			if (isPasteRef.current) {
				appendToPasteBuffer(parsedKey.sequence)
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
						console.log("[DEBUG] Kitty sequence parsed:", result.key)
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
								console.log("[DEBUG] Skipping incomplete sequence, looking for next CSI")
							}
							buffer = buffer.slice(nextStart)
							continue
						}
						break
					}

					// Successfully parsed a key
					if (isDebugEnabled) {
						console.log("[DEBUG] Kitty buffer parsed:", bufferResult.key)
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
						console.warn("[DEBUG] Kitty buffer overflow, clearing:", kittyBuffer)
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
			if (!usePassthrough) return

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
					// No more markers, write remaining data
					keypressStream.write(data.slice(pos))
					break
				}

				// Write data before marker
				if (nextMarkerPos > pos) {
					keypressStream.write(data.slice(pos, nextMarkerPos))
				}

				// Handle marker
				if (isPrefixNext) {
					handleKeypress(undefined, {
						sequence: PASTE_MODE_PREFIX,
						name: "paste-start",
						ctrl: false,
						meta: false,
						shift: false,
					})
					pos = nextMarkerPos + PASTE_MODE_PREFIX.length
				} else if (isSuffixNext) {
					handleKeypress(undefined, {
						sequence: PASTE_MODE_SUFFIX,
						name: "paste-end",
						ctrl: false,
						meta: false,
						shift: false,
					})
					pos = nextMarkerPos + PASTE_MODE_SUFFIX.length
				}
			}
		}

		// Setup event listeners
		keypressStream.on("keypress", handleKeypress)
		if (usePassthrough) {
			stdin.on("data", handleRawData)
		}

		// Cleanup
		return () => {
			keypressStream.removeListener("keypress", handleKeypress)
			if (usePassthrough) {
				stdin.removeListener("data", handleRawData)
			}
			rl.close()

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

			// Flush any pending buffers
			completePaste()
			completeDrag()
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
		pasteBuffer,
		dragBuffer,
		kittyBuffer,
		isKittyEnabled,
		isDebugEnabled,
		completePaste,
		completeDrag,
		clearDragTimer,
		clearBackslashTimer,
	])

	return <>{children}</>
}
