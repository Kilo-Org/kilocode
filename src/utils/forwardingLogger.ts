// MainThread forwarding logger that sends console logs to JetBrains via MainThreadConsole RPC
import * as vscode from "vscode"

interface LogMessage {
	type: string
	severity: string
	arguments: any[]
	source?: string
	line?: number
	columnNumber?: number
	timestamp: number
}

// Store original console methods
const originalConsole = {
	log: console.log,
	info: console.info,
	warn: console.warn,
	error: console.error,
	debug: console.debug,
}

async function forwardToMainThread(level: string, args: any[]) {
	try {
		// Try to access global RPC bridge if available (JetBrains environment)
		const globalThis = global as any
		if (globalThis.rpcProtocol && globalThis.rpcProtocol.getProxy) {
			const mainThreadConsole = globalThis.rpcProtocol.getProxy("MainThreadConsole")
			if (mainThreadConsole && mainThreadConsole.logExtensionHostMessage) {
				await mainThreadConsole.logExtensionHostMessage({
					type: level,
					severity: level,
					arguments: args,
					timestamp: Date.now(),
				})
			}
		}
	} catch (e) {
		// Silently fail if RPC not available - we're probably in VSCode mode
	}
}

function createForwardingLogger(level: string) {
	return (...args: any[]) => {
		// Always call original console method first
		originalConsole[level as keyof typeof originalConsole](...args)
		// Forward to JetBrains if available
		forwardToMainThread(level, args)
	}
}

function restoreConsole() {
	// Restore original console methods
	console.log = originalConsole.log
	console.info = originalConsole.info
	console.warn = originalConsole.warn
	console.error = originalConsole.error
	console.debug = originalConsole.debug
}

/**
 * Register MainThread forwarding for console logs to JetBrains
 * Automatically monkey patches console methods and registers cleanup
 */
export function registerMainThreadForwardingLogger(context: vscode.ExtensionContext) {
	// Replace global console methods with our forwarding versions
	console.log = createForwardingLogger("log")
	console.info = createForwardingLogger("info")
	console.warn = createForwardingLogger("warn")
	console.error = createForwardingLogger("error")
	console.debug = createForwardingLogger("debug")

	// Register cleanup with context
	context.subscriptions.push({ dispose: restoreConsole })
}
