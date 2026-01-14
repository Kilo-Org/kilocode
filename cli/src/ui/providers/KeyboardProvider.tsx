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
import type { KeyboardProviderConfig, ReadlineKey } from "../../types/keyboard.js"
import { logs } from "../../services/logs.js"
import {
	broadcastKeyEventAtom,
	setPasteModeAtom,
	kittySequenceBufferAtom,
	appendToKittyBufferAtom,
	clearKittyBufferAtom,
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
	parseReadlineKey,
	createSpecialKey,
} from "../utils/keyParsing.js"
import { autoEnableKittyProtocol } from "../utils/terminalCapabilities.js"
import {
	ESC,
	PASTE_MODE_PREFIX,
	PASTE_MODE_SUFFIX,
	BACKSLASH,
	BACKSLASH_ENTER_DETECTION_WINDOW_MS,
	MAX_KITTY_SEQUENCE_LENGTH,
} from "../../constants/keyboard/index.js"

interface KeyboardProviderProps {
	children: React.ReactNode
	config?: KeyboardProviderConfig
}

export function KeyboardProvider({ children, config = {} }: KeyboardProviderProps) {
	// escapeCodeTimeout=0 provides instant ESC response. This doesn't break Kitty protocol
	// because those sequences are sent atomically by the terminal and parsed by parseKittySequence().
	const { debugKeystrokeLogging = false, escapeCodeTimeout = 0 } = config

	// Get stdin and raw mode control
	const { stdin, setRawMode } = useStdin()

	// Jotai setters
	const broadcastKey = useSetAtom(broadcastKeyEventAtom)
	const setPasteMode = useSetAtom(setPasteModeAtom)
	const appendToKittyBuffer = useSetAtom(appendToKittyBufferAtom)
	const clearKittyBuffer = useSetAtom(clearKittyBufferAtom)
	const setKittyProtocol = useSetAtom(setKittyProtocolAtom)
	const setDebugLogging = useSetAtom(setDebugLoggingAtom)
	const clearBuffers = useSetAtom(clearBuffersAtom)
	const setupKeyboard = useSetAtom(setupKeyboardAtom)

	// Jotai getters (for reading current state)
	const kittyBuffer = useAtomValue(kittySequenceBufferAtom)
	const isKittyEnabled = useAtomValue(kittyProtocolEnabledAtom)
	const isDebugEnabled = useAtomValue(debugKeystrokeLoggingAtom)

	// Local refs for mutable state
	const isPasteRef = useRef(false)
	const pasteBufferRef = useRef<string>("")
	const backslashTimerRef = useRef<NodeJS.Timeout | null>(null)
	const waitingForEnterRef = useRef(false)

	// Update debug logging atom
	useEffect(() => {
		setDebugLogging(debugKeystrokeLogging)
	}, [debugKeystrokeLogging, setDebugLogging])

	// Clear backslash timer
	const clearBackslashTimer = useCallback(() => {
		if (backslashTimerRef.current) {
			clearTimeout(backslashTimerRef.current)
			backslashTimerRef.current = null
		}
	}, [])

	// Handle paste completion
	const completePaste = useCallback(() => {
		const currentBuffer = pasteBufferRef.current
		const wasPasting = isPasteRef.current

		// Reset paste state
		setPasteMode(false)
		isPasteRef.current = false
		pasteBufferRef.current = ""

		if (wasPasting && currentBuffer) {
			// Normalize line endings: convert \r\n and \r to \n
			const normalizedBuffer = currentBuffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
			// Directly broadcast paste event - skip clipboard image check for bracketed pastes
			// Clipboard image check only runs for explicit Cmd+V (handled in handleGlobalHotkeys)
			broadcastKey({
				name: "",
				ctrl: false,
				meta: false,
				shift: false,
				paste: true,
				sequence: normalizedBuffer,
			})
		}
	}, [setPasteMode, broadcastKey])

	useEffect(() => {
		// Save original raw mode state
		const wasRaw = stdin.isRaw

		// Setup centralized keyboard handler first
		const unsubscribeKeyboard = setupKeyboard()

		// Async initialization
		const init = async () => {
			if (!wasRaw) {
				setRawMode(true)
			}

			// Enable bracketed paste mode
			// This tells the terminal to wrap pasted content with ESC[200~ and ESC[201~
			process.stdout.write("\x1b[?2004h")

			// Auto-detect and enable Kitty protocol if supported
			const kittyEnabled = await autoEnableKittyProtocol()
			if (debugKeystrokeLogging) {
				logs.debug(`Kitty protocol: ${kittyEnabled ? "enabled" : "not supported"}`, "KeyboardProvider")
			}

			// Update atom with actual state
			setKittyProtocol(kittyEnabled)

			keypressStream.on("keypress", handleKeypress)
			if (usePassthrough) {
				stdin.on("data", handleRawData)
			}
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
		const handleKeypress = (_: unknown, key: ReadlineKey) => {
			if (!key) return

			// Parse the key
			const parsedKey = parseReadlineKey(key)

			if (isDebugEnabled) {
				logs.debug("Keypress", "KeyboardProvider", { parsedKey })
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
				if (!usePassthrough) {
					pasteBufferRef.current += parsedKey.sequence
				}
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
					// No more markers
					if (isPasteRef.current) {
						// We're in paste mode - accumulate the remaining data in paste buffer
						pasteBufferRef.current += dataStr.slice(pos)
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
						pasteBufferRef.current += dataStr.slice(pos, nextMarkerPos)
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

		// Cleanup
		return () => {
			keypressStream.removeListener("keypress", handleKeypress)
			if (usePassthrough) {
				stdin.removeListener("data", handleRawData)
			}
			rl.close()

			// Cleanup keyboard handler
			unsubscribeKeyboard()

			// Disable bracketed paste mode
			process.stdout.write("\x1b[?2004l")

			// Restore original raw mode
			if (!wasRaw) {
				setRawMode(false)
			}

			// Clear timers
			clearBackslashTimer()

			// DON'T flush paste buffers here - React StrictMode causes re-mounts
			// that would interrupt an in-progress paste operation.
			// The paste buffer refs persist across re-mounts and will be
			// properly flushed when the paste end marker is received.
		}
	}, [
		stdin,
		setRawMode,
		escapeCodeTimeout,
		broadcastKey,
		setPasteMode,
		appendToKittyBuffer,
		clearKittyBuffer,
		clearBuffers,
		setKittyProtocol,
		kittyBuffer,
		isKittyEnabled,
		isDebugEnabled,
		completePaste,
		clearBackslashTimer,
		setupKeyboard,
	])

	return <>{children}</>
}
