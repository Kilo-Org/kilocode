/**
 * Workspace-related interfaces for VSCode API
 */

import type { Uri } from "../classes/Uri.js"
import type { Thenable, ConfigurationTarget, ConfigurationInspect } from "../types.js"

/**
 * Workspace configuration interface
 */
export interface WorkspaceConfiguration {
	get<T>(section: string): T | undefined
	get<T>(section: string, defaultValue: T): T
	has(section: string): boolean
	inspect<T>(section: string): ConfigurationInspect<T> | undefined
	update(section: string, value: unknown, configurationTarget?: ConfigurationTarget): Thenable<void>
}

/**
 * Quick pick options interface
 */
export interface QuickPickOptions {
	placeHolder?: string
	canPickMany?: boolean
	ignoreFocusOut?: boolean
	matchOnDescription?: boolean
	matchOnDetail?: boolean
}

/**
 * Input box options interface
 */
export interface InputBoxOptions {
	value?: string
	valueSelection?: [number, number]
	prompt?: string
	placeHolder?: string
	password?: boolean
	ignoreFocusOut?: boolean
	validateInput?(value: string): string | undefined | null | Thenable<string | undefined | null>
}

/**
 * Open dialog options interface
 */
export interface OpenDialogOptions {
	defaultUri?: Uri
	openLabel?: string
	canSelectFiles?: boolean
	canSelectFolders?: boolean
	canSelectMany?: boolean
	filters?: { [name: string]: string[] }
	title?: string
}

/**
 * Disposable interface for VSCode API (must be local to avoid conflict with ES2023 built-in Disposable)
 */
export interface Disposable {
	dispose(): void
}

/**
 * Diagnostic collection interface
 */
export interface DiagnosticCollection extends Disposable {
	name: string
	set(uri: Uri, diagnostics: import("../classes/Additional.js").Diagnostic[] | undefined): void
	set(entries: [Uri, import("../classes/Additional.js").Diagnostic[] | undefined][]): void
	delete(uri: Uri): void
	clear(): void
	forEach(
		callback: (
			uri: Uri,
			diagnostics: import("../classes/Additional.js").Diagnostic[],
			collection: DiagnosticCollection,
		) => void,
		thisArg?: unknown,
	): void
	get(uri: Uri): import("../classes/Additional.js").Diagnostic[] | undefined
	has(uri: Uri): boolean
}

/**
 * Identity information for VSCode environment
 */
export interface IdentityInfo {
	machineId: string
	sessionId: string
	cliUserId?: string
}
