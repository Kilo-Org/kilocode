/**
 * ACP (Agent Client Protocol) entry point for Kilo Code CLI.
 *
 * This module provides the main entry point for running the CLI in ACP mode,
 * enabling communication with code editors like Zed that support the ACP protocol.
 */

import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { createKiloCodeAgent } from "./agent.js"
import { ExtensionService } from "../services/extension.js"

/**
 * Debug logging to stderr (doesn't interfere with JSON-RPC on stdout)
 */
let debugEnabled = false

export function enableACPDebug(enabled: boolean): void {
	debugEnabled = enabled
}

export function acpDebug(message: string, ...args: unknown[]): void {
	if (debugEnabled) {
		const timestamp = new Date().toISOString()
		const formatted = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message
		process.stderr.write(`[ACP ${timestamp}] ${formatted}\n`)
	}
}

/**
 * Options for running ACP mode.
 */
export interface ACPServerOptions {
	workspace: string
	debug?: boolean
}

/**
 * Run the CLI in ACP mode.
 *
 * This function sets up the ACP server using stdin/stdout for communication
 * with an ACP client (e.g., Zed editor).
 */
export async function runACPMode(options: ACPServerOptions): Promise<void> {
	// Enable debug if requested
	if (options.debug) {
		enableACPDebug(true)
	}

	acpDebug("Starting ACP mode", { workspace: options.workspace })

	// Create stream from stdin/stdout using the SDK's ndJsonStream helper
	// The SDK expects Web Streams API
	const output = new WritableStream<Uint8Array>({
		write(chunk) {
			acpDebug(">>> SEND:", new TextDecoder().decode(chunk).trim())
			process.stdout.write(chunk)
		},
	})

	const input = new ReadableStream<Uint8Array>({
		start(controller) {
			acpDebug("Input stream started, waiting for messages...")
			process.stdin.on("data", (chunk: Buffer) => {
				const data = chunk.toString()
				acpDebug("<<< RECV:", data.trim())
				controller.enqueue(new Uint8Array(chunk))
			})
			process.stdin.on("end", () => {
				acpDebug("Input stream ended")
				controller.close()
			})
			process.stdin.on("error", (err) => {
				acpDebug("Input stream error:", err.message)
				controller.error(err)
			})
		},
	})

	// Create the ACP stream
	acpDebug("Creating ndJsonStream...")
	const stream = ndJsonStream(output, input)

	// Factory function to create ExtensionService instances
	const createExtensionService = async (workspace: string): Promise<ExtensionService> => {
		acpDebug("Creating ExtensionService for workspace:", workspace)
		try {
			const service = new ExtensionService({
				workspace,
			})

			// Add error and warning handlers to catch any issues
			service.on("error", (error) => {
				acpDebug("ExtensionService ERROR:", error.message, error.stack)
			})

			service.on("warning", (warning) => {
				acpDebug("ExtensionService WARNING:", warning.context, warning.error?.message)
			})

			acpDebug("ExtensionService created, initializing...")
			await service.initialize()
			acpDebug("ExtensionService initialized successfully")

			// Log the initial state to see current config
			const state = service.getState()
			if (state) {
				acpDebug("Initial state - apiProvider:", state.apiConfiguration?.apiProvider)
				acpDebug(
					"Initial state - model:",
					state.apiConfiguration?.kilocodeModel || state.apiConfiguration?.openAiModelId,
				)
			}

			return service
		} catch (error) {
			const err = error as Error
			acpDebug("ExtensionService initialization failed:", err.message, err.stack)
			throw error
		}
	}

	// Create the agent factory
	acpDebug("Creating agent factory...")
	const agentFactory = createKiloCodeAgent(createExtensionService, options.workspace)

	// Create the ACP connection
	acpDebug("Creating AgentSideConnection...")
	const connection = new AgentSideConnection(agentFactory, stream)

	acpDebug("ACP connection established, waiting for messages...")

	// Wait for the connection to close
	await connection.closed
	acpDebug("ACP connection closed")
}
