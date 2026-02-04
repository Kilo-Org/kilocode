/**
 * Webview-related interfaces for VSCode API
 */

import type { Uri } from "../classes/Uri.js"
import type { Thenable, Disposable } from "../types.js"
import type { CancellationToken } from "./document.js"

/**
 * Webview view provider interface
 */
export interface WebviewViewProvider {
	resolveWebviewView(
		webviewView: WebviewView,
		context: WebviewViewResolveContext,
		token: CancellationToken,
	): Thenable<void> | void
}

/**
 * Webview view interface
 */
export interface WebviewView {
	webview: Webview
	viewType: string
	title?: string
	description?: string
	badge?: ViewBadge
	show(preserveFocus?: boolean): void
	onDidChangeVisibility: (listener: () => void) => Disposable
	onDidDispose: (listener: () => void) => Disposable
	visible: boolean
}

/**
 * Webview interface
 */
export interface Webview {
	html: string
	options: WebviewOptions
	cspSource: string
	postMessage(message: unknown): Thenable<boolean>
	onDidReceiveMessage: (listener: (message: unknown) => void) => Disposable
	asWebviewUri(localResource: Uri): Uri
}

/**
 * Webview options interface
 */
export interface WebviewOptions {
	enableScripts?: boolean
	enableForms?: boolean
	localResourceRoots?: readonly Uri[]
	portMapping?: readonly WebviewPortMapping[]
}

/**
 * Webview port mapping interface
 */
export interface WebviewPortMapping {
	webviewPort: number
	extensionHostPort: number
}

/**
 * View badge interface
 */
export interface ViewBadge {
	tooltip: string
	value: number
}

/**
 * Webview view resolve context
 */
export interface WebviewViewResolveContext {
	state?: unknown
}

/**
 * Webview view provider options
 */
export interface WebviewViewProviderOptions {
	retainContextWhenHidden?: boolean
}

/**
 * URI handler interface
 */
export interface UriHandler {
	handleUri(uri: Uri): void
}
