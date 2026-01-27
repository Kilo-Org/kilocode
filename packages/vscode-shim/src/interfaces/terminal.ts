/**
 * Terminal-related interfaces for VSCode API
 */

import type { Uri } from "../classes/Uri.js"
import type { ThemeIcon } from "../classes/Additional.js"
import type { Thenable } from "../types.js"

/**
 * Represents a terminal in VSCode
 */
export interface Terminal {
	name: string
	processId: Thenable<number | undefined>
	creationOptions: Readonly<TerminalOptions>
	exitStatus: TerminalExitStatus | undefined
	state: TerminalState
	sendText(text: string, addNewLine?: boolean): void
	show(preserveFocus?: boolean): void
	hide(): void
	dispose(): void
}

/**
 * Options for creating a terminal
 */
export interface TerminalOptions {
	name?: string
	shellPath?: string
	shellArgs?: string[] | string
	cwd?: string | Uri
	env?: { [key: string]: string | null | undefined }
	iconPath?: Uri | ThemeIcon
	hideFromUser?: boolean
	message?: string
	strictEnv?: boolean
}

/**
 * Exit status of a terminal
 */
export interface TerminalExitStatus {
	code: number | undefined
	reason: number
}

/**
 * State of a terminal
 */
export interface TerminalState {
	isInteractedWith: boolean
}

/**
 * Event fired when terminal dimensions change
 */
export interface TerminalDimensionsChangeEvent {
	terminal: Terminal
	dimensions: TerminalDimensions
}

/**
 * Terminal dimensions
 */
export interface TerminalDimensions {
	columns: number
	rows: number
}

/**
 * Event fired when data is written to terminal
 */
export interface TerminalDataWriteEvent {
	terminal: Terminal
	data: string
}
