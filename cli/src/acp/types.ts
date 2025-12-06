/**
 * ACP (Agent Client Protocol) types for Kilo Code integration.
 *
 * This module provides TypeScript type definitions and re-exports for the ACP SDK
 * to simplify imports throughout the ACP implementation.
 */

// Re-export schema types from the SDK
export * from "@agentclientprotocol/sdk"
import * as schema from "@agentclientprotocol/sdk"
export { schema }

/**
 * Options for initializing the ACP server.
 */
export interface ACPServerOptions {
	workspace: string
}
