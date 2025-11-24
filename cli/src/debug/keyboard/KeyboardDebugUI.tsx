/**
 * KeyboardDebugUI - Interactive keyboard event debugger
 * Displays real-time keyboard events with raw sequences and parsed data
 */

import React, { useEffect, useState } from "react"
import { Box, Text } from "ink"
import { useAtomValue, useSetAtom } from "jotai"
import {
	currentKeyEventAtom,
	keyEventHistoryAtom,
	kittyProtocolEnabledAtom,
	subscribeToKeyboardAtom,
} from "../../state/atoms/keyboard.js"
import type { Key } from "../../types/keyboard.js"

interface KeyboardDebugUIProps {
	onExit: () => void
}

/**
 * Format a string to show escape sequences in readable format
 */
function escapeSequence(str: string): string {
	return str
		.split("")
		.map((char) => {
			const code = char.charCodeAt(0)
			// Show non-printable characters as hex
			if (code === 0x1b) {
				return "\\x1b"
			}
			if (code === 0x0d) {
				return "\\r"
			}
			if (code === 0x0a) {
				return "\\n"
			}
			if (code === 0x09) {
				return "\\t"
			}
			if (code < 32 || code > 126) {
				return `\\x${code.toString(16).padStart(2, "0")}`
			}
			return char
		})
		.join("")
}

/**
 * Format timestamp to HH:MM:SS.mmm
 */
function formatTimestamp(date: Date): string {
	const hours = date.getHours().toString().padStart(2, "0")
	const minutes = date.getMinutes().toString().padStart(2, "0")
	const seconds = date.getSeconds().toString().padStart(2, "0")
	const ms = date.getMilliseconds().toString().padStart(3, "0")
	return `${hours}:${minutes}:${seconds}.${ms}`
}

/**
 * Format modifiers as a compact string
 */
function formatModifiers(key: Key): string {
	const mods: string[] = []
	if (key.ctrl) mods.push("ctrl")
	if (key.meta) mods.push("meta")
	if (key.shift) mods.push("shift")
	return mods.length > 0 ? mods.join("+") : "-"
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.slice(0, maxLength) + "..."
}

/**
 * Count lines in text
 */
function countLines(text: string): number {
	return text.split("\n").length
}

/**
 * Current Event Panel - Shows detailed information about the most recent key event
 */
const CurrentEventPanel: React.FC<{ event: Key | null; kittyEnabled: boolean }> = ({ event, kittyEnabled }) => {
	if (!event) {
		return (
			<Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
				<Text bold color="cyan">
					Current Event
				</Text>
				<Text dimColor>Waiting for keyboard input...</Text>
			</Box>
		)
	}

	const timestamp = formatTimestamp(new Date())
	const escapedSequence = escapeSequence(event.sequence)

	// Handle paste events specially
	if (event.paste) {
		const content = event.sequence
		const totalChars = content.length
		const totalLines = countLines(content)
		const preview = truncate(content, 200)
		const showingChars = preview.length

		return (
			<Box borderStyle="round" borderColor="blue" paddingX={1} flexDirection="column">
				<Text bold color="cyan">
					Current Event (PASTE)
				</Text>
				<Text dimColor>Time: {timestamp}</Text>
				<Text> </Text>
				<Text color="blue">Paste Content (truncated at 200 chars):</Text>
				<Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
					<Text>{preview}</Text>
				</Box>
				<Text> </Text>
				<Text color="yellow">Stats:</Text>
				<Text> Total Characters: {totalChars.toLocaleString()}</Text>
				<Text> Total Lines: {totalLines}</Text>
				<Text>
					{" "}
					Shown: {showingChars} / {totalChars} chars
				</Text>
			</Box>
		)
	}

	// Regular key event
	return (
		<Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
			<Text bold color="cyan">
				Current Event
			</Text>
			<Text dimColor>Time: {timestamp}</Text>
			<Text> </Text>
			<Text color="yellow">Raw Sequence: </Text>
			<Text> {escapedSequence}</Text>
			<Text> </Text>
			<Text color="yellow">Parsed Key:</Text>
			<Text> name: "{event.name}"</Text>
			<Text> ctrl: {event.ctrl ? "true" : "false"}</Text>
			<Text> meta: {event.meta ? "true" : "false"}</Text>
			<Text> shift: {event.shift ? "true" : "false"}</Text>
			<Text> paste: {event.paste ? "true" : "false"}</Text>
			<Text> kittyProtocol: {event.kittyProtocol ? "true" : "false"}</Text>
			<Text> </Text>
			<Text color="yellow">Kitty Protocol: </Text>
			<Text> {kittyEnabled ? "✓ Enabled" : "✗ Disabled"}</Text>
		</Box>
	)
}

/**
 * Event History Panel - Shows a scrolling list of recent events
 */
const EventHistoryPanel: React.FC<{ history: Key[] }> = ({ history }) => {
	// Show last 20 events, most recent at bottom
	const recentEvents = history.slice(-20)

	return (
		<Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" marginTop={1}>
			<Text bold color="cyan">
				Event History (Last 20)
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{recentEvents.length === 0 ? (
					<Text dimColor>No events yet...</Text>
				) : (
					recentEvents.map((event, index) => {
						const timestamp = formatTimestamp(new Date())
						const modifiers = formatModifiers(event)
						const sequence = truncate(escapeSequence(event.sequence), 20)
						const keyName = event.paste ? "paste" : event.name || "?"

						// Color code by event type
						let color = "white"
						if (event.paste) color = "blue"
						else if (event.kittyProtocol) color = "yellow"
						else if (event.name) color = "green"
						else color = "red"

						return (
							<Text key={index} color={color}>
								{timestamp} | {keyName.padEnd(10)} | {modifiers.padEnd(12)} | {sequence}
							</Text>
						)
					})
				)}
			</Box>
		</Box>
	)
}

/**
 * Main Keyboard Debug UI Component
 */
export const KeyboardDebugUI: React.FC<KeyboardDebugUIProps> = ({ onExit }) => {
	const currentEvent = useAtomValue(currentKeyEventAtom)
	const eventHistory = useAtomValue(keyEventHistoryAtom)
	const kittyEnabled = useAtomValue(kittyProtocolEnabledAtom)
	const subscribeToKeyboard = useSetAtom(subscribeToKeyboardAtom)
	const [, setForceUpdate] = useState(0)

	// Subscribe to keyboard events and handle exit keys
	useEffect(() => {
		const unsubscribe = subscribeToKeyboard((key: Key) => {
			// Handle exit on ESC or Ctrl+C
			if (key.name === "escape" || (key.ctrl && key.name === "c")) {
				onExit()
				return
			}

			// Force re-render to update display
			setForceUpdate((n) => n + 1)
		})

		return () => {
			unsubscribe()
		}
	}, [subscribeToKeyboard, onExit])

	return (
		<Box flexDirection="column" padding={1}>
			<Box borderStyle="double" borderColor="cyan" paddingX={1} marginBottom={1}>
				<Text bold color="cyan">
					Kilo Code - Keyboard Debug Tool
				</Text>
				<Text dimColor> - Press any key to see events | ESC or Ctrl+C to exit</Text>
			</Box>

			<EventHistoryPanel history={eventHistory} />
			<CurrentEventPanel event={currentEvent} kittyEnabled={kittyEnabled} />
		</Box>
	)
}
