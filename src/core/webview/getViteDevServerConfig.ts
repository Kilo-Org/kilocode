import * as fs from "node:fs"
import * as path from "node:path"
import axios from "axios"
import type { Webview } from "vscode"
import { getNonce } from "./getNonce"

const DEFAULT_VITE_PORT = "5173"

export interface ViteDevServerConfig {
	localServerUrl: string
	port: string
	nonce: string
	reactRefreshScript: string
	csp: string[]
}

/**
 * Reads the Vite dev server port from the .vite-port file.
 * Falls back to the default port (5173) if the file doesn't exist.
 */
export function getVitePort(): string {
	try {
		const portFilePath = path.resolve(__dirname, "../../.vite-port")

		if (fs.existsSync(portFilePath)) {
			return fs.readFileSync(portFilePath, "utf8").trim()
		}
	} catch (error) {
		console.warn("Failed to read .vite-port file, using default port:", error)
	}

	return DEFAULT_VITE_PORT
}

/**
 * Checks if the Vite dev server is running at the given URL.
 */
export async function isViteServerRunning(localServerUrl: string): Promise<boolean> {
	try {
		await axios.get(`http://${localServerUrl}`)
		return true
	} catch {
		return false
	}
}

/**
 * Generates the React Fast Refresh script for HMR support.
 */
export function getReactRefreshScript(port: string, nonce: string): string {
	return /*html*/ `
		<script nonce="${nonce}" type="module">
			import RefreshRuntime from "http://localhost:${port}/@react-refresh"
			RefreshRuntime.injectIntoGlobalHook(window)
			window.$RefreshReg$ = () => {}
			window.$RefreshSig$ = () => (type) => type
			window.__vite_plugin_react_preamble_installed__ = true
		</script>
	`
}

/**
 * Generates the Content Security Policy for development mode with Vite HMR.
 */
export function getDevCsp(webview: Webview, localServerUrl: string, port: string, nonce: string): string[] {
	return [
		"default-src 'none'",
		`font-src ${webview.cspSource} data:`,
		`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${port}`,
		`img-src ${webview.cspSource} data:`,
		`script-src 'unsafe-eval' ${webview.cspSource} https://* http://${localServerUrl} http://0.0.0.0:${port} 'nonce-${nonce}'`,
		`connect-src ${webview.cspSource} ws://${localServerUrl} ws://0.0.0.0:${port} http://${localServerUrl} http://0.0.0.0:${port}`,
	]
}

/**
 * Gets the full Vite dev server configuration for HMR support.
 * Returns null if the dev server is not running.
 */
export async function getViteDevServerConfig(webview: Webview): Promise<ViteDevServerConfig | null> {
	const port = getVitePort()
	const localServerUrl = `localhost:${port}`

	if (!(await isViteServerRunning(localServerUrl))) {
		return null
	}

	const nonce = getNonce()

	return {
		localServerUrl,
		port,
		nonce,
		reactRefreshScript: getReactRefreshScript(port, nonce),
		csp: getDevCsp(webview, localServerUrl, port, nonce),
	}
}
