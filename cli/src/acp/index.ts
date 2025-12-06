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
 * Options for running ACP mode.
 */
export interface ACPServerOptions {
	workspace: string
}

/**
 * Run the CLI in ACP mode.
 *
 * This function sets up the ACP server using stdin/stdout for communication
 * with an ACP client (e.g., Zed editor).
 */
export async function runACPMode(options: ACPServerOptions): Promise<void> {
	// Create stream from stdin/stdout using the SDK's ndJsonStream helper
	// The SDK expects Web Streams API
	const output = new WritableStream<Uint8Array>({
		write(chunk) {
			process.stdout.write(chunk)
		},
	})

	const input = new ReadableStream<Uint8Array>({
		start(controller) {
			process.stdin.on("data", (chunk: Buffer) => {
				controller.enqueue(new Uint8Array(chunk))
			})
			process.stdin.on("end", () => {
				controller.close()
			})
			process.stdin.on("error", (err) => {
				controller.error(err)
			})
		},
	})

	// Create the ACP stream
	const stream = ndJsonStream(output, input)

	// Factory function to create ExtensionService instances
	const createExtensionService = async (workspace: string): Promise<ExtensionService> => {
		const service = new ExtensionService({
			workspace,
		})
		await service.initialize()
		return service
	}

	// Create the agent factory
	const agentFactory = createKiloCodeAgent(createExtensionService, options.workspace)

	// Create the ACP connection
	const connection = new AgentSideConnection(agentFactory, stream)

	// Wait for the connection to close
	await connection.closed
}
