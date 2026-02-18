import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import ReconnectingEventSource from "reconnecting-eventsource"
import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import chokidar, { FSWatcher } from "chokidar"
import delay from "delay"
import deepEqual from "fast-deep-equal"
import { z } from "zod"

import type {
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpTool,
	McpToolCallResponse,
} from "@roo-code/types"

import { McpAuthStatus, McpAuthDebugInfo } from "../../shared/mcp" // kilocode_change
import { t } from "../../i18n"

import { ClineProvider } from "../../core/webview/ClineProvider"

import { GlobalFileNames } from "../../shared/globalFileNames"

import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual, getWorkspacePath } from "../../utils/path"
import { injectVariables } from "../../utils/config"
import { NotificationService } from "./kilocode/NotificationService"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { sanitizeMcpName } from "../../utils/mcp-name"
// kilocode_change start - MCP OAuth Authorization
import { McpOAuthService, OAuthTokens } from "./oauth"
// kilocode_change end
// Discriminated union for connection states
export type ConnectedMcpConnection = {
	type: "connected"
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
}

export type DisconnectedMcpConnection = {
	type: "disconnected"
	server: McpServer
	client: null
	transport: null
}

export type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection

// Enum for disable reasons
export enum DisableReason {
	MCP_DISABLED = "mcpDisabled",
	SERVER_DISABLED = "serverDisabled",
}

// OAuth configuration schema for HTTP-based transports
// kilocode_change start - MCP OAuth Authorization
const OAuthConfigSchema = z
	.object({
		// Override client_id if pre-registered
		clientId: z.string().optional(),
		clientSecret: z.string().optional(),

		// Override scopes to request
		scopes: z.array(z.string()).optional(),

		// Disable OAuth for this server (use static headers instead)
		disabled: z.boolean().optional(),
	})
	.optional()
// kilocode_change end

// Base configuration schema for common settings
const BaseConfigSchema = z.object({
	disabled: z.boolean().optional(),
	timeout: z.number().min(1).max(3600).optional().default(60),
	alwaysAllow: z.array(z.string()).default([]),
	watchPaths: z.array(z.string()).optional(), // paths to watch for changes and restart server
	disabledTools: z.array(z.string()).default([]),
})

// Custom error messages for better user feedback
const typeErrorMessage = "Server type must be 'stdio', 'sse', or 'streamable-http'"
const stdioFieldsErrorMessage =
	"For 'stdio' type servers, you must provide a 'command' field and can optionally include 'args' and 'env'"
const sseFieldsErrorMessage =
	"For 'sse' type servers, you must provide a 'url' field and can optionally include 'headers'"
const streamableHttpFieldsErrorMessage =
	"For 'streamable-http' type servers, you must provide a 'url' field and can optionally include 'headers'"
const mixedFieldsErrorMessage =
	"Cannot mix 'stdio' and ('sse' or 'streamable-http') fields. For 'stdio' use 'command', 'args', and 'env'. For 'sse'/'streamable-http' use 'url' and 'headers'"
const missingFieldsErrorMessage =
	"Server configuration must include either 'command' (for stdio) or 'url' (for sse/streamable-http) and a corresponding 'type' if 'url' is used."

// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
	return z.union([
		// Stdio config (has command field)
		BaseConfigSchema.extend({
			type: z.enum(["stdio"]).optional(),
			command: z.string().min(1, "Command cannot be empty"),
			args: z.array(z.string()).optional(),
			cwd: z.string().default(() => vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath ?? process.cwd()),
			env: z.record(z.string()).optional(),
			// Ensure no SSE fields are present
			url: z.undefined().optional(),
			headers: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "stdio" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "stdio", { message: typeErrorMessage }),
		// SSE config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["sse"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			oauth: OAuthConfigSchema, // kilocode_change - MCP OAuth Authorization
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "sse" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "sse", { message: typeErrorMessage }),
		// StreamableHTTP config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["streamable-http"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			oauth: OAuthConfigSchema, // kilocode_change - MCP OAuth Authorization
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "streamable-http" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "streamable-http", {
				message: typeErrorMessage,
			}),
	])
}

// Server configuration schema with automatic type inference and validation
export const ServerConfigSchema = createServerTypeSchema()

// Settings schema
const McpSettingsSchema = z.object({
	mcpServers: z.record(ServerConfigSchema),
})

export class McpHub {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private settingsWatcher?: vscode.FileSystemWatcher
	private fileWatchers: Map<string, FSWatcher[]> = new Map()
	private projectMcpWatcher?: vscode.FileSystemWatcher
	private isDisposed: boolean = false
	connections: McpConnection[] = []
	isConnecting: boolean = false
	readonly kiloNotificationService = new NotificationService()
	private refCount: number = 0 // Reference counter for active clients
	private configChangeDebounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private isProgrammaticUpdate: boolean = false
	private flagResetTimer?: NodeJS.Timeout
	private sanitizedNameRegistry: Map<string, string> = new Map()
	// kilocode_change start - MCP OAuth Authorization
	private oauthService?: McpOAuthService
	// kilocode_change end
	// kilocode_change start - Auto-reconnect on disconnect
	private reconnectAttempts: Map<string, number> = new Map()
	private reconnectTimers: Map<string, NodeJS.Timeout> = new Map()
	private static readonly MAX_RECONNECT_ATTEMPTS = 5
	private static readonly INITIAL_RECONNECT_DELAY_MS = 1000
	private static readonly MAX_RECONNECT_DELAY_MS = 30000
	// kilocode_change end

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		// kilocode_change start - MCP OAuth Authorization
		this.initializeOAuthService()
		// kilocode_change end
		this.watchMcpSettingsFile()
		this.watchProjectMcpFile().catch(console.error)
		this.setupWorkspaceFoldersWatcher()
		this.initializeGlobalMcpServers()
		this.initializeProjectMcpServers()
	}

	// kilocode_change start - MCP OAuth Authorization
	/**
	 * Initializes the OAuth service if a context is available
	 */
	private initializeOAuthService(): void {
		const provider = this.providerRef.deref()
		if (provider?.context) {
			this.oauthService = new McpOAuthService(provider.context)
		}
	}

	/**
	 * Gets OAuth tokens for an HTTP-based server, refreshing if needed
	 * @param serverUrl The MCP server URL
	 * @param oauthConfig Optional OAuth configuration overrides
	 * @returns OAuth tokens if available, null otherwise
	 */
	private async getOAuthTokensForServer(
		serverUrl: string,
		oauthConfig?: {
			clientId?: string
			clientSecret?: string
			scopes?: string[]
			disabled?: boolean
		},
	): Promise<OAuthTokens | null> {
		// If OAuth is explicitly disabled for this server, skip
		if (oauthConfig?.disabled) {
			return null
		}

		if (!this.oauthService) {
			return null
		}

		try {
			// Check if tokens need refresh
			const { needsRefresh, canRefresh, tokens } = await this.oauthService.checkTokenRefreshNeeded(serverUrl)

			if (!tokens) {
				// No stored tokens - will need OAuth flow when server returns 401
				return null
			}

			if (needsRefresh) {
				if (canRefresh) {
					console.log(`Token for ${serverUrl} is expired or expiring soon, attempting refresh`)
					const refreshedTokens = await this.oauthService.refreshAccessToken(serverUrl)
					if (refreshedTokens) {
						console.log(`Successfully refreshed token for ${serverUrl}`)
						return refreshedTokens
					}
					// Refresh failed - the tokens might still work if not fully expired yet
					console.log(`Token refresh failed for ${serverUrl}, using existing tokens`)
				} else {
					console.log(
						`Token for ${serverUrl} needs refresh but cannot refresh (no refresh token or metadata)`,
					)
				}
			}

			return tokens
		} catch (error) {
			console.error(`Failed to get OAuth tokens for ${serverUrl}:`, error)
			return null
		}
	}

	/**
	 * Initiates OAuth flow for a server that requires authentication
	 * @param serverUrl The MCP server URL
	 * @param wwwAuthenticateHeader The WWW-Authenticate header from 401 response
	 * @param oauthConfig Optional OAuth configuration overrides
	 * @returns OAuth tokens if successful
	 */
	async initiateOAuthForServer(
		serverUrl: string,
		wwwAuthenticateHeader?: string,
		oauthConfig?: {
			clientId?: string
			clientSecret?: string
			scopes?: string[]
		},
	): Promise<OAuthTokens | null> {
		if (!this.oauthService) {
			console.error("OAuth service not initialized")
			return null
		}

		try {
			// Show notification to user
			vscode.window.showInformationMessage(
				t("mcp:info.oauth_required", { serverUrl }) || `MCP server requires authentication: ${serverUrl}`,
			)

			const tokens = await this.oauthService.initiateOAuthFlow(serverUrl, wwwAuthenticateHeader, {
				clientId: oauthConfig?.clientId,
				clientSecret: oauthConfig?.clientSecret,
				scopes: oauthConfig?.scopes,
			})

			vscode.window.showInformationMessage(
				t("mcp:info.oauth_success", { serverUrl }) || `Successfully authenticated with: ${serverUrl}`,
			)

			return tokens
		} catch (error) {
			console.error(`OAuth flow failed for ${serverUrl}:`, error)
			vscode.window.showErrorMessage(
				t("mcp:errors.oauth_failed", { serverUrl, error: String(error) }) ||
					`OAuth authentication failed for ${serverUrl}: ${error}`,
			)
			return null
		}
	}

	/**
	 * Clears OAuth tokens for a server (for logout/re-auth)
	 * @param serverUrl The MCP server URL
	 */
	async clearOAuthTokens(serverUrl: string): Promise<void> {
		if (this.oauthService) {
			await this.oauthService.clearTokens(serverUrl)
		}
	}

	/**
	 * Initiates OAuth sign-in for a server by name (called from webview)
	 * @param serverName The MCP server name
	 * @param source The server source (global or project)
	 * @returns Promise<void>
	 */
	async initiateOAuthSignIn(serverName: string, source?: "global" | "project"): Promise<void> {
		const connection = this.findConnection(serverName, source)
		if (!connection) {
			throw new Error(`Server ${serverName} not found`)
		}

		// Parse the config to get the URL
		const config = JSON.parse(connection.server.config)
		if (config.type !== "sse" && config.type !== "streamable-http") {
			throw new Error(`Server ${serverName} is not an HTTP-based server`)
		}

		const serverUrl = config.url
		if (!serverUrl) {
			throw new Error(`Server ${serverName} does not have a URL configured`)
		}

		// Get OAuth config overrides if any
		const oauthConfig = config.oauth

		// Only clear tokens to force re-authentication, but keep client credentials
		// from Dynamic Client Registration to reuse the registered client_id
		if (this.oauthService) {
			console.log(`Clearing stored tokens for re-authentication (keeping client credentials)...`)
			await this.oauthService.clearTokens(serverUrl)
		}

		// Initiate the OAuth flow
		const tokens = await this.initiateOAuthForServer(serverUrl, undefined, {
			clientId: oauthConfig?.clientId,
			clientSecret: oauthConfig?.clientSecret,
			scopes: oauthConfig?.scopes,
		})

		if (tokens) {
			// OAuth successful - restart the connection to use the new tokens
			await this.restartConnection(serverName, connection.server.source)
		}
	}

	/**
	 * Builds the auth status for an HTTP-based server
	 * @param serverUrl The MCP server URL
	 * @param oauthTokens The OAuth tokens if available
	 * @param oauthConfig OAuth configuration for the server
	 * @param hasStaticAuth Whether static auth headers are configured
	 * @param debugInfo Optional debug information about the OAuth tokens
	 * @returns The McpAuthStatus object
	 */
	private buildAuthStatus(
		serverUrl: string,
		oauthTokens: OAuthTokens | null,
		oauthConfig?: { disabled?: boolean },
		hasStaticAuth?: boolean,
		debugInfo?: McpAuthDebugInfo | null,
	): McpAuthStatus {
		// OAuth is explicitly disabled - check for static auth
		if (oauthConfig?.disabled) {
			return {
				method: hasStaticAuth ? "static" : "none",
				status: hasStaticAuth ? "authenticated" : "none",
			}
		}

		// Have OAuth tokens
		if (oauthTokens) {
			const isExpired = oauthTokens.expiresAt ? oauthTokens.expiresAt < Date.now() : false
			const hasRefreshToken = !!oauthTokens.refreshToken
			return {
				method: "oauth",
				// If expired but has refresh token, still consider it authenticated (will auto-refresh)
				status: isExpired && !hasRefreshToken ? "expired" : "authenticated",
				expiresAt: oauthTokens.expiresAt,
				scopes: oauthTokens.scope?.split(" "),
				debug: debugInfo || undefined,
			}
		}

		// No OAuth tokens - check if static auth is configured
		if (hasStaticAuth) {
			return {
				method: "static",
				status: "authenticated",
			}
		}

		// No auth configured - may require OAuth
		return {
			method: "none",
			status: "none",
		}
	}

	/**
	 * Checks if an error indicates OAuth authentication is required (401 response)
	 * @param error The error to check
	 * @returns True if the error is a 401 requiring OAuth
	 */
	private isOAuthRequiredError(error: unknown): boolean {
		if (error instanceof Error) {
			const message = error.message.toLowerCase()
			// Check for 401 status code in error message or error object properties
			if (
				message.includes("401") ||
				message.includes("unauthorized") ||
				message.includes("invalid_token") ||
				message.includes("missing or invalid access token")
			) {
				return true
			}
			// Check for code property on the error
			if ((error as any).code === 401) {
				return true
			}
		}
		return false
	}

	/**
	 * Extracts WWW-Authenticate header value from error if available
	 * @param error The error to check
	 * @returns The WWW-Authenticate header value or undefined
	 */
	private extractWwwAuthenticateHeader(error: unknown): string | undefined {
		if (error instanceof Error) {
			// Check if the error has headers
			const headers = (error as any).headers
			if (headers) {
				return headers["www-authenticate"] || headers["WWW-Authenticate"]
			}
		}
		return undefined
	}
	/**
	 * Normalizes OAuth token type to proper HTTP Authorization header casing.
	 * OAuth servers may return "bearer" (lowercase) but HTTP headers typically use "Bearer" (title case).
	 * Most authorization validation libraries expect title case.
	 * @param tokenType The token type from OAuth response (e.g., "bearer", "Bearer", "BEARER")
	 * @returns The normalized token type with proper casing (e.g., "Bearer")
	 */
	private normalizeTokenType(tokenType: string): string {
		// Handle common token types with proper casing
		const lowerType = tokenType.toLowerCase()
		switch (lowerType) {
			case "bearer":
				return "Bearer"
			case "basic":
				return "Basic"
			case "digest":
				return "Digest"
			case "hoba":
				return "HOBA"
			case "mutual":
				return "Mutual"
			case "negotiate":
				return "Negotiate"
			case "oauth":
				return "OAuth"
			case "scram-sha-1":
				return "SCRAM-SHA-1"
			case "scram-sha-256":
				return "SCRAM-SHA-256"
			case "vapid":
				return "vapid"
			default:
				// For unknown types, capitalize first letter
				return tokenType.charAt(0).toUpperCase() + tokenType.slice(1).toLowerCase()
		}
	}
	/**
	 * Schedules an automatic reconnection attempt for a disconnected server.
	 * Uses exponential backoff with a maximum number of attempts.
	 * @param serverName The name of the server to reconnect
	 * @param source The server source (global or project)
	 */
	private scheduleReconnect(serverName: string, source: "global" | "project"): void {
		const key = `${source}-${serverName}`

		// Don't schedule if already scheduled or if hub is disposed
		if (this.reconnectTimers.has(key) || this.isDisposed) {
			return
		}

		const attempts = this.reconnectAttempts.get(key) || 0

		// Check if we've exceeded max attempts
		if (attempts >= McpHub.MAX_RECONNECT_ATTEMPTS) {
			console.log(
				`Max reconnect attempts (${McpHub.MAX_RECONNECT_ATTEMPTS}) reached for "${serverName}", giving up`,
			)
			this.reconnectAttempts.delete(key)
			return
		}

		// Calculate delay with exponential backoff
		const delayMs = Math.min(
			McpHub.INITIAL_RECONNECT_DELAY_MS * Math.pow(2, attempts),
			McpHub.MAX_RECONNECT_DELAY_MS,
		)

		console.log(`Scheduling reconnect for "${serverName}" in ${delayMs}ms (attempt ${attempts + 1})`)

		const timer = setTimeout(async () => {
			this.reconnectTimers.delete(key)

			// Check if server is still disconnected and not disabled
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.server.status !== "disconnected" || connection.server.disabled) {
				// Server is no longer disconnected or was disabled, clear attempts
				this.reconnectAttempts.delete(key)
				return
			}

			// Check if the server requires OAuth authentication
			if (connection.server.authStatus?.status === "required") {
				// Don't auto-reconnect if OAuth is required - user must sign in
				console.log(`Skipping auto-reconnect for "${serverName}" - OAuth authentication required`)
				this.reconnectAttempts.delete(key)
				return
			}

			// Increment attempt counter
			this.reconnectAttempts.set(key, attempts + 1)

			try {
				console.log(`Auto-reconnecting to "${serverName}" (attempt ${attempts + 1})`)
				await this.restartConnection(serverName, source)

				// Check if reconnection was successful
				const updatedConnection = this.findConnection(serverName, source)
				if (updatedConnection?.server.status === "connected") {
					console.log(`Successfully reconnected to "${serverName}"`)
					this.reconnectAttempts.delete(key)
				} else {
					// Still disconnected, schedule another attempt
					this.scheduleReconnect(serverName, source)
				}
			} catch (error) {
				console.error(`Failed to reconnect to "${serverName}":`, error)
				// Schedule another attempt
				this.scheduleReconnect(serverName, source)
			}
		}, delayMs)

		this.reconnectTimers.set(key, timer)
	}

	/**
	 * Cancels any scheduled reconnect for a server.
	 * @param serverName The name of the server
	 * @param source The server source (global or project)
	 */
	private cancelReconnect(serverName: string, source: "global" | "project"): void {
		const key = `${source}-${serverName}`
		const timer = this.reconnectTimers.get(key)
		if (timer) {
			clearTimeout(timer)
			this.reconnectTimers.delete(key)
		}
		this.reconnectAttempts.delete(key)
	}

	/**
	 * Resets the reconnect attempt counter for a server.
	 * Call this when a server successfully connects.
	 * @param serverName The name of the server
	 * @param source The server source (global or project)
	 */
	private resetReconnectAttempts(serverName: string, source: "global" | "project"): void {
		const key = `${source}-${serverName}`
		this.reconnectAttempts.delete(key)
	}
	// kilocode_change end
	/**
	 * Registers a client (e.g., ClineProvider) using this hub.
	 * Increments the reference count.
	 */
	public registerClient(): void {
		this.refCount++
		// console.log(`McpHub: Client registered. Ref count: ${this.refCount}`)
	}

	/**
	 * Unregisters a client. Decrements the reference count.
	 * If the count reaches zero, disposes the hub.
	 */
	public async unregisterClient(): Promise<void> {
		this.refCount--

		// console.log(`McpHub: Client unregistered. Ref count: ${this.refCount}`)

		if (this.refCount <= 0) {
			console.log("McpHub: Last client unregistered. Disposing hub.")
			await this.dispose()
		}
	}

	/**
	 * Validates and normalizes server configuration
	 * @param config The server configuration to validate
	 * @param serverName Optional server name for error messages
	 * @returns The validated configuration
	 * @throws Error if the configuration is invalid
	 */
	private validateServerConfig(config: any, serverName?: string): z.infer<typeof ServerConfigSchema> {
		// Detect configuration issues before validation
		const hasStdioFields = config.command !== undefined
		const hasUrlFields = config.url !== undefined // Covers sse and streamable-http

		// Check for mixed fields (stdio vs url-based)
		if (hasStdioFields && hasUrlFields) {
			throw new Error(mixedFieldsErrorMessage)
		}

		// Infer type for stdio if not provided
		if (!config.type && hasStdioFields) {
			config.type = "stdio"
		}

		// For url-based configs, type must be provided by the user
		if (hasUrlFields && !config.type) {
			throw new Error("Configuration with 'url' must explicitly specify 'type' as 'sse' or 'streamable-http'.")
		}

		// Validate type if provided
		if (config.type && !["stdio", "sse", "streamable-http"].includes(config.type)) {
			throw new Error(typeErrorMessage)
		}

		// Check for type/field mismatch
		if (config.type === "stdio" && !hasStdioFields) {
			throw new Error(stdioFieldsErrorMessage)
		}
		if (config.type === "sse" && !hasUrlFields) {
			throw new Error(sseFieldsErrorMessage)
		}
		if (config.type === "streamable-http" && !hasUrlFields) {
			throw new Error(streamableHttpFieldsErrorMessage)
		}

		// If neither command nor url is present (type alone is not enough)
		if (!hasStdioFields && !hasUrlFields) {
			throw new Error(missingFieldsErrorMessage)
		}

		// Validate the config against the schema
		try {
			return ServerConfigSchema.parse(config)
		} catch (validationError) {
			if (validationError instanceof z.ZodError) {
				// Extract and format validation errors
				const errorMessages = validationError.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("; ")
				throw new Error(
					serverName
						? `Invalid configuration for server "${serverName}": ${errorMessages}`
						: `Invalid server configuration: ${errorMessages}`,
				)
			}
			throw validationError
		}
	}

	/**
	 * Formats and displays error messages to the user
	 * @param message The error message prefix
	 * @param error The error object
	 */
	private showErrorMessage(message: string, error: unknown): void {
		console.error(`${message}:`, error)
	}

	public setupWorkspaceFoldersWatcher(): void {
		// Skip if test environment is detected
		if (process.env.NODE_ENV === "test") {
			return
		}

		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async () => {
				await this.updateProjectMcpServers()
				await this.watchProjectMcpFile()
			}),
		)
	}

	/**
	 * Debounced wrapper for handling config file changes
	 */
	private debounceConfigChange(filePath: string, source: "global" | "project"): void {
		// Skip processing if this is a programmatic update to prevent unnecessary server restarts
		if (this.isProgrammaticUpdate) {
			return
		}

		const key = `${source}-${filePath}`

		// Clear existing timer if any
		const existingTimer = this.configChangeDebounceTimers.get(key)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		// Set new timer
		const timer = setTimeout(async () => {
			this.configChangeDebounceTimers.delete(key)
			await this.handleConfigFileChange(filePath, source)
		}, 500) // 500ms debounce

		this.configChangeDebounceTimers.set(key, timer)
	}

	private async handleConfigFileChange(filePath: string, source: "global" | "project"): Promise<void> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			const result = McpSettingsSchema.safeParse(config)

			if (!result.success) {
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
				return
			}

			await this.updateServerConnections(result.data.mcpServers || {}, source)
		} catch (error) {
			// Check if the error is because the file doesn't exist
			if (error.code === "ENOENT" && source === "project") {
				// File was deleted, clean up project MCP servers
				await this.cleanupProjectMcpServers()
				await this.notifyWebviewOfServerChanges()
				vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
			} else {
				this.showErrorMessage(t("mcp:errors.failed_update_project"), error)
			}
		}
	}

	private async watchProjectMcpFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// Clean up existing project MCP watcher if it exists
		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		if (!vscode.workspace.workspaceFolders?.length) {
			return
		}

		const workspaceFolder = this.providerRef.deref()?.cwd ?? getWorkspacePath()
		const projectMcpPattern = new vscode.RelativePattern(workspaceFolder, ".kilocode/mcp.json")

		// Create a file system watcher for the project MCP file pattern
		this.projectMcpWatcher = vscode.workspace.createFileSystemWatcher(projectMcpPattern)

		// Watch for file changes
		const changeDisposable = this.projectMcpWatcher.onDidChange((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		// Watch for file creation
		const createDisposable = this.projectMcpWatcher.onDidCreate((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		// Watch for file deletion
		const deleteDisposable = this.projectMcpWatcher.onDidDelete(async () => {
			// Clean up all project MCP servers when the file is deleted
			await this.cleanupProjectMcpServers()
			await this.notifyWebviewOfServerChanges()
			vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
		})

		this.disposables.push(
			vscode.Disposable.from(changeDisposable, createDisposable, deleteDisposable, this.projectMcpWatcher),
		)
	}

	private async updateProjectMcpServers(): Promise<void> {
		try {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) return

			const content = await fs.readFile(projectMcpPath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			// Validate configuration structure
			const result = McpSettingsSchema.safeParse(config)
			if (result.success) {
				await this.updateServerConnections(result.data.mcpServers || {}, "project")
			} else {
				// Format validation errors for better user feedback
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				console.error("Invalid project MCP settings format:", errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
			}
		} catch (error) {
			this.showErrorMessage(t("mcp:errors.failed_update_project"), error)
		}
	}

	private async cleanupProjectMcpServers(): Promise<void> {
		// Disconnect and remove all project MCP servers
		const projectConnections = this.connections.filter((conn) => conn.server.source === "project")

		for (const conn of projectConnections) {
			await this.deleteConnection(conn.server.name, "project")
		}

		// Clear project servers from the connections list
		await this.updateServerConnections({}, "project", false)
	}

	getServers(): McpServer[] {
		// Only return enabled servers, deduplicating by name with project servers taking priority
		const enabledConnections = this.connections.filter((conn) => !conn.server.disabled)

		// Deduplicate by server name: project servers take priority over global servers
		const serversByName = new Map<string, McpServer>()
		for (const conn of enabledConnections) {
			const existing = serversByName.get(conn.server.name)
			if (!existing) {
				serversByName.set(conn.server.name, conn.server)
			} else if (conn.server.source === "project" && existing.source !== "project") {
				// Project server overrides global server with the same name
				serversByName.set(conn.server.name, conn.server)
			}
			// If existing is project and current is global, keep existing (project wins)
		}

		return Array.from(serversByName.values())
	}

	getAllServers(): McpServer[] {
		// Return all servers regardless of state
		return this.connections.map((conn) => conn.server)
	}

	async getMcpServersPath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	async getMcpSettingsFilePath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpSettingsFilePath = path.join(
			await provider.ensureSettingsDirectoryExists(),
			GlobalFileNames.mcpSettings,
		)
		const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
		if (!fileExists) {
			await fs.writeFile(
				mcpSettingsFilePath,
				`{
  "mcpServers": {

  }
}`,
			)
		}
		return mcpSettingsFilePath
	}

	private async watchMcpSettingsFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		// Clean up existing settings watcher if it exists
		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		const settingsPath = await this.getMcpSettingsFilePath()
		const settingsUri = vscode.Uri.file(settingsPath)
		const settingsPattern = new vscode.RelativePattern(path.dirname(settingsPath), path.basename(settingsPath))

		// Create a file system watcher for the global MCP settings file
		this.settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern)

		// Watch for file changes
		const changeDisposable = this.settingsWatcher.onDidChange((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		// Watch for file creation
		const createDisposable = this.settingsWatcher.onDidCreate((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		this.disposables.push(vscode.Disposable.from(changeDisposable, createDisposable, this.settingsWatcher))
	}

	private async initializeMcpServers(source: "global" | "project"): Promise<void> {
		try {
			const configPath =
				source === "global" ? await this.getMcpSettingsFilePath() : await this.getProjectMcpPath()

			if (!configPath) {
				return
			}

			const content = await fs.readFile(configPath, "utf-8")
			const config = JSON.parse(content)
			const result = McpSettingsSchema.safeParse(config)

			if (result.success) {
				// Pass all servers including disabled ones - they'll be handled in updateServerConnections
				await this.updateServerConnections(result.data.mcpServers || {}, source, false)
			} else {
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				console.error(`Invalid ${source} MCP settings format:`, errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))

				if (source === "global") {
					// Still try to connect with the raw config, but show warnings
					try {
						await this.updateServerConnections(config.mcpServers || {}, source, false)
					} catch (error) {
						this.showErrorMessage(`Failed to initialize ${source} MCP servers with raw config`, error)
					}
				}
			}
		} catch (error) {
			if (error instanceof SyntaxError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				console.error(errorMessage, error)
				vscode.window.showErrorMessage(errorMessage)
			} else {
				this.showErrorMessage(`Failed to initialize ${source} MCP servers`, error)
			}
		}
	}

	private async initializeGlobalMcpServers(): Promise<void> {
		await this.initializeMcpServers("global")
	}

	// kilocode_change start
	// Check alternative MCP configuration paths (for compatibility with other tools)
	private async checkAlternativeMcpPaths(workspacePath: string): Promise<string | null> {
		const alternativePaths = [
			path.join(workspacePath, ".cursor", "mcp.json"),
			path.join(workspacePath, ".mcp.json"),
		]

		for (const mcpPath of alternativePaths) {
			try {
				await fs.access(mcpPath)
				return mcpPath
			} catch {
				// Ignore errors and try the next path
			}
		}

		return null
	}
	// kilocode_change end

	// Get project-level MCP configuration path
	private async getProjectMcpPath(): Promise<string | null> {
		const workspacePath = this.providerRef.deref()?.cwd ?? getWorkspacePath()
		const projectMcpDir = path.join(workspacePath, ".kilocode")
		const projectMcpPath = path.join(projectMcpDir, "mcp.json")

		try {
			await fs.access(projectMcpPath)
			return projectMcpPath
		} catch {
			// kilocode_change
			return this.checkAlternativeMcpPaths(workspacePath)

			// If not found in .kilocode/, fall back to .mcp.json in root directory
			const rootMcpPath = path.join(workspacePath, ".mcp.json")
			try {
				await fs.access(rootMcpPath)
				return rootMcpPath
			} catch {
				return null
			}
		}
	}

	// Initialize project-level MCP servers
	private async initializeProjectMcpServers(): Promise<void> {
		await this.initializeMcpServers("project")
	}

	/**
	 * Creates a placeholder connection for disabled servers or when MCP is globally disabled
	 * @param name The server name
	 * @param config The server configuration
	 * @param source The source of the server (global or project)
	 * @param reason The reason for creating a placeholder (mcpDisabled or serverDisabled)
	 * @returns A placeholder DisconnectedMcpConnection object
	 */
	private createPlaceholderConnection(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project",
		reason: DisableReason,
	): DisconnectedMcpConnection {
		return {
			type: "disconnected",
			server: {
				name,
				config: JSON.stringify(config),
				status: "disconnected",
				disabled: reason === DisableReason.SERVER_DISABLED ? true : config.disabled,
				source,
				projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
				errorHistory: [],
			},
			client: null,
			transport: null,
		}
	}

	/**
	 * Checks if MCP is globally enabled
	 * @returns Promise<boolean> indicating if MCP is enabled
	 */
	private async isMcpEnabled(): Promise<boolean> {
		const provider = this.providerRef.deref()
		if (!provider) {
			return true // Default to enabled if provider is not available
		}
		const state = await provider.getState()
		return state.mcpEnabled ?? true
	}

	private async connectToServer(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	): Promise<void> {
		// Remove existing connection if it exists with the same source
		await this.deleteConnection(name, source)

		// Register the sanitized name for O(1) lookup
		const sanitizedName = sanitizeMcpName(name)
		this.sanitizedNameRegistry.set(sanitizedName, name)

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.MCP_DISABLED)
			this.connections.push(connection)
			return
		}

		// Skip connecting to disabled servers
		if (config.disabled) {
			// Still create a connection object to track the server, but don't actually connect
			const connection = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED)
			this.connections.push(connection)
			return
		}

		// Set up file watchers for enabled servers
		this.setupFileWatcher(name, config, source)

		try {
			const client = new Client(
				{
					name: "Kilo Code",
					version: this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

			// Inject variables to the config (environment, magic variables,...)
			const configInjected = (await injectVariables(config, {
				env: process.env,
				workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
			})) as typeof config

			if (configInjected.type === "stdio") {
				// On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
				// This is necessary for node version managers (fnm, nvm-windows, volta) that implement
				// commands as PowerShell scripts rather than executables.
				// Note: This adds a small overhead as commands go through an additional shell layer.
				const isWindows = process.platform === "win32"

				// Check if command is already cmd.exe to avoid double-wrapping
				const isAlreadyWrapped =
					configInjected.command.toLowerCase() === "cmd.exe" || configInjected.command.toLowerCase() === "cmd"

				const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : configInjected.command
				const args =
					isWindows && !isAlreadyWrapped
						? ["/c", configInjected.command, ...(configInjected.args || [])]
						: configInjected.args

				transport = new StdioClientTransport({
					command,
					args,
					cwd: configInjected.cwd,
					env: {
						...getDefaultEnvironment(),
						...(configInjected.env || {}),
					},
					stderr: "pipe",
				})

				// Set up stdio specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
					// kilocode_change - Schedule auto-reconnect on error
					this.scheduleReconnect(name, source)
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
					// kilocode_change - Schedule auto-reconnect on close
					this.scheduleReconnect(name, source)
				}

				// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
				// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
				await transport.start()
				const stderrStream = transport.stderr
				if (stderrStream) {
					stderrStream.on("data", async (data: Buffer) => {
						const output = data.toString()
						// Check if output contains INFO level log
						const isInfoLog = /INFO/i.test(output)

						if (isInfoLog) {
							// Log normal informational messages
							console.log(`Server "${name}" info:`, output)
						} else {
							// Treat as error log
							console.error(`Server "${name}" stderr:`, output)
							const connection = this.findConnection(name, source)
							if (connection) {
								this.appendErrorMessage(connection, output)
								if (connection.server.status === "disconnected") {
									await this.notifyWebviewOfServerChanges()
								}
							}
						}
					})
				} else {
					console.error(`No stderr stream for ${name}`)
				}
			} else if (configInjected.type === "streamable-http") {
				// Streamable HTTP connection
				// kilocode_change start - MCP OAuth Authorization: Inject OAuth tokens if available
				let httpHeaders: Record<string, string> = { ...(configInjected.headers || {}) }
				const oauthConfig = (configInjected as any).oauth
				if (!oauthConfig?.disabled) {
					const oauthTokens = await this.getOAuthTokensForServer(configInjected.url, oauthConfig)
					if (oauthTokens) {
						httpHeaders["Authorization"] =
							`${this.normalizeTokenType(oauthTokens.tokenType)} ${oauthTokens.accessToken}`
					}
				}
				// kilocode_change end

				transport = new StreamableHTTPClientTransport(new URL(configInjected.url), {
					requestInit: {
						headers: httpHeaders,
					},
				})

				// Set up Streamable HTTP specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}" (streamable-http):`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
					// kilocode_change - Schedule auto-reconnect on error
					this.scheduleReconnect(name, source)
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
					// kilocode_change - Schedule auto-reconnect on close
					this.scheduleReconnect(name, source)
				}
			} else if (configInjected.type === "sse") {
				// SSE connection
				// kilocode_change start - MCP OAuth Authorization: Inject OAuth tokens if available
				let sseHeaders: Record<string, string> = { ...(configInjected.headers || {}) }
				const sseOauthConfig = (configInjected as any).oauth
				if (!sseOauthConfig?.disabled) {
					const sseOauthTokens = await this.getOAuthTokensForServer(configInjected.url, sseOauthConfig)
					if (sseOauthTokens) {
						sseHeaders["Authorization"] =
							`${this.normalizeTokenType(sseOauthTokens.tokenType)} ${sseOauthTokens.accessToken}`
					}
				}
				// kilocode_change end

				const sseOptions = {
					requestInit: {
						headers: sseHeaders,
					},
				}
				// Configure ReconnectingEventSource options
				const reconnectingEventSourceOptions = {
					max_retry_time: 5000, // Maximum retry time in milliseconds
					withCredentials: sseHeaders?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
					fetch: (url: string | URL, init: RequestInit) => {
						const headers = new Headers(init?.headers)
						for (const [key, value] of Object.entries(sseHeaders)) {
							headers.set(key, value)
						}
						return fetch(url, {
							...init,
							headers,
						})
					},
				}
				global.EventSource = ReconnectingEventSource
				transport = new SSEClientTransport(new URL(configInjected.url), {
					...sseOptions,
					eventSourceInit: reconnectingEventSourceOptions,
				})

				// Set up SSE specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
					// kilocode_change - Schedule auto-reconnect on error
					this.scheduleReconnect(name, source)
				}

				transport.onclose = async () => {
					const connection = this.findConnection(name, source)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
					// kilocode_change - Schedule auto-reconnect on close
					this.scheduleReconnect(name, source)
				}
			} else {
				// Should not happen if validateServerConfig is correct
				throw new Error(`Unsupported MCP server type: ${(configInjected as any).type}`)
			}

			// Only override transport.start for stdio transports that have already been started
			if (configInjected.type === "stdio") {
				transport.start = async () => {}
			}

			// kilocode_change start - MCP OAuth Authorization: Build auth status for HTTP-based transports
			let authStatus: McpAuthStatus | undefined
			if (configInjected.type === "streamable-http" || configInjected.type === "sse") {
				const httpOauthConfig = (configInjected as any).oauth
				const hasStaticAuth = !!configInjected.headers?.["Authorization"]
				// Get stored tokens for auth status (we already fetched them above during token injection)
				const storedTokens = !httpOauthConfig?.disabled
					? await this.getOAuthTokensForServer(configInjected.url, httpOauthConfig)
					: null
				// Get debug info for the auth status
				let debugInfo: McpAuthDebugInfo | null = null
				if (this.oauthService && storedTokens) {
					const tokenDebugInfo = await this.oauthService.getTokenDebugInfo(configInjected.url)
					if (tokenDebugInfo) {
						debugInfo = {
							issuedAt: tokenDebugInfo.issuedAt,
							hasRefreshToken: tokenDebugInfo.hasRefreshToken,
							tokenEndpoint: tokenDebugInfo.tokenEndpoint,
							clientId: tokenDebugInfo.clientId,
							canRefresh: tokenDebugInfo.canRefresh,
							nextRefreshAt: tokenDebugInfo.nextRefreshAt,
						}
					}
				}
				authStatus = this.buildAuthStatus(
					configInjected.url,
					storedTokens,
					httpOauthConfig,
					hasStaticAuth,
					debugInfo,
				)
			}
			// kilocode_change end

			// Create a connected connection
			const connection: ConnectedMcpConnection = {
				type: "connected",
				server: {
					name,
					config: JSON.stringify(configInjected),
					status: "connecting",
					disabled: configInjected.disabled,
					source,
					projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
					errorHistory: [],
					// kilocode_change start - MCP OAuth Authorization
					authStatus,
					// kilocode_change end
				},
				client,
				transport,
			}
			this.connections.push(connection)

			// Connect (this will automatically start the transport)
			await client.connect(transport)
			connection.server.status = "connected"
			connection.server.error = ""
			connection.server.instructions = client.getInstructions()
			// kilocode_change - Reset reconnect attempts on successful connection
			this.resetReconnectAttempts(name, source)

			this.kiloNotificationService.connect(name, connection.client)

			// Initial fetch of tools and resources
			await this.fetchAvailableServerCapabilities(name, source) // kilocode_change: logic moved into method
		} catch (error) {
			// kilocode_change start - MCP OAuth Authorization: Handle 401 errors
			// Check if this is an HTTP-based transport and if the error indicates OAuth is required
			// Instead of automatically opening the auth flow, we just set the status to "required"
			// and let the user click "Sign in" to trigger the OAuth flow
			if (
				(config.type === "streamable-http" || config.type === "sse") &&
				this.isOAuthRequiredError(error) &&
				!(config as any).oauth?.disabled
			) {
				console.log(`OAuth required for "${name}", showing sign-in button (not auto-opening auth flow)`)

				// Remove the failed connection before creating placeholder
				await this.deleteConnection(name, source)

				// Create disconnected connection with auth status showing sign-in is required
				// The user must click "Sign in" to initiate the OAuth flow
				const connection = this.createPlaceholderConnection(name, config, source, DisableReason.SERVER_DISABLED)
				connection.server.disabled = false // Not actually disabled, just requires auth
				connection.server.status = "disconnected"
				connection.server.error = "Authentication required. Click 'Sign in' to authenticate."
				connection.server.authStatus = {
					method: "oauth",
					status: "required",
				}
				this.connections.push(connection)
				await this.notifyWebviewOfServerChanges()
				return
			}
			// kilocode_change end

			// Update status with error
			const connection = this.findConnection(name, source)
			if (connection) {
				connection.server.status = "disconnected"
				this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			}
			throw error
		}
	}

	private appendErrorMessage(connection: McpConnection, error: string, level: "error" | "warn" | "info" = "error") {
		const MAX_ERROR_LENGTH = 1000
		const truncatedError =
			error.length > MAX_ERROR_LENGTH
				? `${error.substring(0, MAX_ERROR_LENGTH)}...(error message truncated)`
				: error

		// Add to error history
		if (!connection.server.errorHistory) {
			connection.server.errorHistory = []
		}

		connection.server.errorHistory.push({
			message: truncatedError,
			timestamp: Date.now(),
			level,
		})

		// Keep only the last 100 errors
		if (connection.server.errorHistory.length > 100) {
			connection.server.errorHistory = connection.server.errorHistory.slice(-100)
		}

		// Update current error display
		connection.server.error = truncatedError
	}

	/**
	 * Helper method to find a connection by server name and source
	 * @param serverName The name of the server to find
	 * @param source Optional source to filter by (global or project)
	 * @returns The matching connection or undefined if not found
	 */
	private findConnection(serverName: string, source?: "global" | "project"): McpConnection | undefined {
		// If source is specified, only find servers with that source
		if (source !== undefined) {
			return this.connections.find((conn) => conn.server.name === serverName && conn.server.source === source)
		}

		// If no source is specified, first look for project servers, then global servers
		// This ensures that when servers have the same name, project servers are prioritized
		const projectConn = this.connections.find(
			(conn) => conn.server.name === serverName && conn.server.source === "project",
		)
		if (projectConn) return projectConn

		// If no project server is found, look for global servers
		return this.connections.find(
			(conn) => conn.server.name === serverName && (conn.server.source === "global" || !conn.server.source),
		)
	}

	// kilocode_change start: method added
	/**
	 * Helper method to set the supported server capabilities
	 * @param serverName The name of the server to find
	 * @param source Optional source to filter by (global or project)
	 */
	private async fetchAvailableServerCapabilities(serverName: string, source?: "global" | "project") {
		// Use the helper method to find the connection
		const connection = this.findConnection(serverName, source)

		if (!connection || connection.type !== "connected") {
			return
		}

		if (connection.client.getServerCapabilities()?.tools) {
			connection.server.tools = await this.fetchToolsList(serverName, source)
		}
		if (connection.client.getServerCapabilities()?.resources) {
			connection.server.resources = await this.fetchResourcesList(serverName, source)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(serverName, source)
		}
	}
	// kilocode_change end
	/**
	 * Find a connection by sanitized server name.
	 * This is used when parsing MCP tool responses where the server name has been
	 * sanitized (e.g., hyphens replaced with underscores) for API compliance.
	 * @param sanitizedServerName The sanitized server name from the API tool call
	 * @returns The original server name if found, or null if no match
	 */
	public findServerNameBySanitizedName(sanitizedServerName: string): string | null {
		const exactMatch = this.connections.find((conn) => conn.server.name === sanitizedServerName)
		if (exactMatch) {
			return exactMatch.server.name
		}

		return this.sanitizedNameRegistry.get(sanitizedServerName) ?? null
	}

	private async fetchToolsList(serverName: string, source?: "global" | "project"): Promise<McpTool[]> {
		try {
			// Use the helper method to find the connection
			const connection = this.findConnection(serverName, source)

			if (!connection || connection.type !== "connected") {
				return []
			}

			// kilocode_change start
			// Only proceed of the server defined the tools capability.
			if (!connection.client.getServerCapabilities()?.tools) {
				return []
			}
			// kilocode_change end

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema)

			// Determine the actual source of the server
			const actualSource = connection.server.source || "global"
			let configPath: string
			let alwaysAllowConfig: string[] = []
			let disabledToolsList: string[] = []

			// Read from the appropriate config file based on the actual source
			try {
				let serverConfigData: Record<string, any> = {}
				if (actualSource === "project") {
					// Get project MCP config path
					const projectMcpPath = await this.getProjectMcpPath()
					if (projectMcpPath) {
						configPath = projectMcpPath
						const content = await fs.readFile(configPath, "utf-8")
						serverConfigData = JSON.parse(content)
					}
				} else {
					// Get global MCP settings path
					configPath = await this.getMcpSettingsFilePath()
					const content = await fs.readFile(configPath, "utf-8")
					serverConfigData = JSON.parse(content)
				}
				if (serverConfigData) {
					alwaysAllowConfig = serverConfigData.mcpServers?.[serverName]?.alwaysAllow || []
					disabledToolsList = serverConfigData.mcpServers?.[serverName]?.disabledTools || []
				}
			} catch (error) {
				console.error(`Failed to read tool configuration for ${serverName}:`, error)
				// Continue with empty configs
			}

			// Mark tools as always allowed and enabled for prompt based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				alwaysAllow: alwaysAllowConfig.includes(tool.name),
				enabledForPrompt: !disabledToolsList.includes(tool.name),
			}))

			return tools
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourcesList(serverName: string, source?: "global" | "project"): Promise<McpResource[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}

			// kilocode_change start
			// Only proceed of the server defined the resources capability.
			if (!connection.client.getServerCapabilities()?.resources) {
				return []
			}
			// kilocode_change end

			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema)
			return response?.resources || []
		} catch (error) {
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourceTemplatesList(
		serverName: string,
		source?: "global" | "project",
	): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}

			// kilocode_change start
			// Only proceed of the server defined the resources capability.
			if (!connection.client.getServerCapabilities()?.resources) {
				return []
			}
			// kilocode_change end

			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
			)
			return response?.resourceTemplates || []
		} catch (error) {
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	async deleteConnection(name: string, source?: "global" | "project"): Promise<void> {
		// Clean up file watchers for this server
		this.removeFileWatchersForServer(name)

		// kilocode_change - Cancel any pending reconnect attempts
		if (source) {
			this.cancelReconnect(name, source)
		} else {
			// Cancel for both sources if not specified
			this.cancelReconnect(name, "global")
			this.cancelReconnect(name, "project")
		}

		// If source is provided, only delete connections from that source
		const connections = source
			? this.connections.filter((conn) => conn.server.name === name && conn.server.source === source)
			: this.connections.filter((conn) => conn.server.name === name)

		for (const connection of connections) {
			try {
				if (connection.type === "connected") {
					// kilocode_change start
					// Fire-and-forget: don't await close() calls as they can block
					// waiting for the subprocess to exit. The MCP SDK's transport.close()
					// waits up to 2 seconds for the process to exit gracefully before
					// sending SIGTERM, then another 2 seconds before SIGKILL.
					// This 4+ second delay is unacceptable during CLI shutdown.
					connection.transport.close().catch((err) => {
						console.error(`Error closing transport for ${name}:`, err)
					})
					connection.client.close().catch((err) => {
						console.error(`Error closing client for ${name}:`, err)
					})
					// kilocode_change end
				}
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
		}

		// Remove the connections from the array
		this.connections = this.connections.filter((conn) => {
			if (conn.server.name !== name) return true
			if (source && conn.server.source !== source) return true
			return false
		})

		// Remove from sanitized name registry if no more connections with this name exist
		const remainingConnections = this.connections.filter((conn) => conn.server.name === name)
		if (remainingConnections.length === 0) {
			const sanitizedName = sanitizeMcpName(name)
			this.sanitizedNameRegistry.delete(sanitizedName)
		}
	}

	async updateServerConnections(
		newServers: Record<string, any>,
		source: "global" | "project" = "global",
		manageConnectingState: boolean = true,
	): Promise<void> {
		if (manageConnectingState) {
			this.isConnecting = true
		}
		this.removeAllFileWatchers()
		// Filter connections by source
		const currentConnections = this.connections.filter(
			(conn) => conn.server.source === source || (!conn.server.source && source === "global"),
		)
		const currentNames = new Set(currentConnections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.deleteConnection(name, source)
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			// Only consider connections that match the current source
			const currentConnection = this.findConnection(name, source)

			// Validate and transform the config
			let validatedConfig: z.infer<typeof ServerConfigSchema>
			try {
				validatedConfig = this.validateServerConfig(config, name)
			} catch (error) {
				this.showErrorMessage(`Invalid configuration for MCP server "${name}"`, error)
				continue
			}

			if (!currentConnection) {
				// New server
				try {
					// Only setup file watcher for enabled servers
					if (!validatedConfig.disabled) {
						this.setupFileWatcher(name, validatedConfig, source)
					}
					await this.connectToServer(name, validatedConfig, source)
				} catch (error) {
					this.showErrorMessage(`Failed to connect to new MCP server ${name}`, error)
				}
			} else if (
				/* kilocode_change start */
				!deepEqual(
					JSON.parse(currentConnection.server.config),
					await injectVariables(validatedConfig, {
						env: process.env,
						workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
					}),
				)
				/* kilocode_change end */
			) {
				// Existing server with changed config
				try {
					// Only setup file watcher for enabled servers
					if (!validatedConfig.disabled) {
						this.setupFileWatcher(name, validatedConfig, source)
					}
					await this.deleteConnection(name, source)
					await this.connectToServer(name, validatedConfig, source)
				} catch (error) {
					this.showErrorMessage(`Failed to reconnect MCP server ${name}`, error)
				}
			}
			// If server exists with same config, do nothing
		}
		await this.notifyWebviewOfServerChanges()
		if (manageConnectingState) {
			this.isConnecting = false
		}
	}

	private setupFileWatcher(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	) {
		// Initialize an empty array for this server if it doesn't exist
		if (!this.fileWatchers.has(name)) {
			this.fileWatchers.set(name, [])
		}

		const watchers = this.fileWatchers.get(name) || []

		// Only stdio type has args
		if (config.type === "stdio") {
			// Setup watchers for custom watchPaths if defined
			if (config.watchPaths && config.watchPaths.length > 0) {
				const watchPathsWatcher = chokidar.watch(config.watchPaths, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true,
				})

				watchPathsWatcher.on("change", async (changedPath) => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${changedPath}:`, error)
					}
				})

				watchers.push(watchPathsWatcher)
			}

			// Also setup the fallback build/index.js watcher if applicable
			const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
			if (filePath) {
				// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor
				const indexJsWatcher = chokidar.watch(filePath, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true, // This helps with atomic writes
				})

				indexJsWatcher.on("change", async () => {
					try {
						// Pass the source from the config to restartConnection
						await this.restartConnection(name, source)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${filePath}:`, error)
					}
				})

				watchers.push(indexJsWatcher)
			}

			// Update the fileWatchers map with all watchers for this server
			if (watchers.length > 0) {
				this.fileWatchers.set(name, watchers)
			}
		}
	}

	private removeAllFileWatchers() {
		this.fileWatchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()))
		this.fileWatchers.clear()
	}

	private removeFileWatchersForServer(serverName: string) {
		const watchers = this.fileWatchers.get(serverName)
		if (watchers) {
			watchers.forEach((watcher) => watcher.close())
			this.fileWatchers.delete(serverName)
		}
	}

	async restartConnection(serverName: string, source?: "global" | "project"): Promise<void> {
		this.isConnecting = true

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			this.isConnecting = false
			return
		}

		// Get existing connection and update its status
		const connection = this.findConnection(serverName, source)
		const config = connection?.server.config
		if (config) {
			vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await delay(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName, connection.server.source)
				// Parse the config to validate it
				const parsedConfig = JSON.parse(config)
				try {
					// Validate the config
					const validatedConfig = this.validateServerConfig(parsedConfig, serverName)

					// Try to connect again using validated config
					await this.connectToServer(serverName, validatedConfig, connection.server.source || "global")
					vscode.window.showInformationMessage(t("mcp:info.server_connected", { serverName }))
				} catch (validationError) {
					this.showErrorMessage(`Invalid configuration for MCP server "${serverName}"`, validationError)
				}
			} catch (error) {
				this.showErrorMessage(`Failed to restart ${serverName} MCP server connection`, error)
			}
		}

		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	public async refreshAllConnections(): Promise<void> {
		if (this.isConnecting) {
			return
		}

		// Check if MCP is globally enabled
		const mcpEnabled = await this.isMcpEnabled()
		if (!mcpEnabled) {
			// Clear all existing connections
			const existingConnections = [...this.connections]
			for (const conn of existingConnections) {
				await this.deleteConnection(conn.server.name, conn.server.source)
			}

			// Still initialize servers to track them, but they won't connect
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await this.notifyWebviewOfServerChanges()
			return
		}

		this.isConnecting = true

		try {
			const globalPath = await this.getMcpSettingsFilePath()
			let globalServers: Record<string, any> = {}
			try {
				const globalContent = await fs.readFile(globalPath, "utf-8")
				const globalConfig = JSON.parse(globalContent)
				globalServers = globalConfig.mcpServers || {}
				const globalServerNames = Object.keys(globalServers)
			} catch (error) {
				console.log("Error reading global MCP config:", error)
			}

			const projectPath = await this.getProjectMcpPath()
			let projectServers: Record<string, any> = {}
			if (projectPath) {
				try {
					const projectContent = await fs.readFile(projectPath, "utf-8")
					const projectConfig = JSON.parse(projectContent)
					projectServers = projectConfig.mcpServers || {}
					const projectServerNames = Object.keys(projectServers)
				} catch (error) {
					console.log("Error reading project MCP config:", error)
				}
			}

			// Clear all existing connections first
			const existingConnections = [...this.connections]
			for (const conn of existingConnections) {
				await this.deleteConnection(conn.server.name, conn.server.source)
			}

			// Re-initialize all servers from scratch
			// This ensures proper initialization including fetching tools, resources, etc.
			await this.initializeMcpServers("global")
			await this.initializeMcpServers("project")

			await delay(100)

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage("Failed to refresh MCP servers", error)
		} finally {
			this.isConnecting = false
		}
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		// Get global server order from settings file
		const settingsPath = await this.getMcpSettingsFilePath()
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)
		const globalServerOrder = Object.keys(config.mcpServers || {})

		// Get project server order if available
		const projectMcpPath = await this.getProjectMcpPath()
		let projectServerOrder: string[] = []
		if (projectMcpPath) {
			try {
				const projectContent = await fs.readFile(projectMcpPath, "utf-8")
				const projectConfig = JSON.parse(projectContent)
				projectServerOrder = Object.keys(projectConfig.mcpServers || {})
			} catch (error) {
				// Silently continue with empty project server order
			}
		}

		// Sort connections: first project servers in their defined order, then global servers in their defined order
		// This ensures that when servers have the same name, project servers are prioritized
		const sortedConnections = [...this.connections].sort((a, b) => {
			const aIsGlobal = a.server.source === "global" || !a.server.source
			const bIsGlobal = b.server.source === "global" || !b.server.source

			// If both are global or both are project, sort by their respective order
			if (aIsGlobal && bIsGlobal) {
				const indexA = globalServerOrder.indexOf(a.server.name)
				const indexB = globalServerOrder.indexOf(b.server.name)
				return indexA - indexB
			} else if (!aIsGlobal && !bIsGlobal) {
				const indexA = projectServerOrder.indexOf(a.server.name)
				const indexB = projectServerOrder.indexOf(b.server.name)
				return indexA - indexB
			}

			// Project servers come before global servers (reversed from original)
			return aIsGlobal ? 1 : -1
		})

		// Send sorted servers to webview
		const targetProvider: ClineProvider | undefined = this.providerRef.deref()

		if (targetProvider) {
			const serversToSend = sortedConnections.map((connection) => connection.server)

			const message = {
				type: "mcpServers" as const,
				mcpServers: serversToSend,
			}

			try {
				await targetProvider.postMessageToWebview(message)
			} catch (error) {
				console.error("[McpHub] Error calling targetProvider.postMessageToWebview:", error)
			}
		} else {
			console.error(
				"[McpHub] No target provider available (neither from getInstance nor providerRef) - cannot send mcpServers message to webview",
			)
		}
	}

	public async toggleServerDisabled(
		serverName: string,
		disabled: boolean,
		source?: "global" | "project",
	): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { disabled }, serverSource)

			// Update the connection object
			if (connection) {
				try {
					connection.server.disabled = disabled

					// If disabling a connected server, disconnect it
					if (disabled && connection.server.status === "connected") {
						// Clean up file watchers when disabling
						this.removeFileWatchersForServer(serverName)
						await this.deleteConnection(serverName, serverSource)
						// Re-add as a disabled connection
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.connectToServer(serverName, updatedConfig, serverSource)
					} else if (!disabled && connection.server.status === "disconnected") {
						// If enabling a disabled server, connect it
						// Re-read config from file to get updated disabled state
						const updatedConfig = await this.readServerConfigFromFile(serverName, serverSource)
						await this.deleteConnection(serverName, serverSource)
						// When re-enabling, file watchers will be set up in connectToServer
						await this.connectToServer(serverName, updatedConfig, serverSource)
					} else if (connection.server.status === "connected") {
						// Only refresh capabilities if connected
						await this.fetchAvailableServerCapabilities(serverName, serverSource) // kilocode_change: logic moved into method
					}
				} catch (error) {
					console.error(`Failed to refresh capabilities for ${serverName}:`, error)
				}
			}

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} state`, error)
			throw error
		}
	}

	/**
	 * Helper method to read a server's configuration from the appropriate settings file
	 * @param serverName The name of the server to read
	 * @param source Whether to read from the global or project config
	 * @returns The validated server configuration
	 */
	private async readServerConfigFromFile(
		serverName: string,
		source: "global" | "project" = "global",
	): Promise<z.infer<typeof ServerConfigSchema>> {
		// Determine which config file to read
		let configPath: string
		if (source === "project") {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			configPath = await this.getMcpSettingsFilePath()
		}

		// Ensure the settings file exists and is accessible
		try {
			await fs.access(configPath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}

		// Read and parse the config file
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		// Validate the config structure
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			throw new Error("No mcpServers section in config")
		}

		if (!config.mcpServers[serverName]) {
			throw new Error(`Server ${serverName} not found in config`)
		}

		// Validate and return the server config
		return this.validateServerConfig(config.mcpServers[serverName], serverName)
	}

	/**
	 * Helper method to update a server's configuration in the appropriate settings file
	 * @param serverName The name of the server to update
	 * @param configUpdate The configuration updates to apply
	 * @param source Whether to update the global or project config
	 */
	private async updateServerConfig(
		serverName: string,
		configUpdate: Record<string, any>,
		source: "global" | "project" = "global",
	): Promise<void> {
		// Determine which config file to update
		let configPath: string
		if (source === "project") {
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			configPath = await this.getMcpSettingsFilePath()
		}

		// Ensure the settings file exists and is accessible
		try {
			await fs.access(configPath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}

		// Read and parse the config file
		const content = await fs.readFile(configPath, "utf-8")
		const config = JSON.parse(content)

		// Validate the config structure
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}

		if (!config.mcpServers || typeof config.mcpServers !== "object") {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {}
		}

		// Create a new server config object to ensure clean structure
		const serverConfig = {
			...config.mcpServers[serverName],
			...configUpdate,
		}

		// Ensure required fields exist
		if (!serverConfig.alwaysAllow) {
			serverConfig.alwaysAllow = []
		}

		config.mcpServers[serverName] = serverConfig

		// Write the entire config back
		const updatedConfig = {
			mcpServers: config.mcpServers,
		}

		// Set flag to prevent file watcher from triggering server restart
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
		try {
			await safeWriteJson(configPath, updatedConfig)
		} finally {
			// Reset flag after watcher debounce period (non-blocking)
			this.flagResetTimer = setTimeout(() => {
				this.isProgrammaticUpdate = false
				this.flagResetTimer = undefined
			}, 600)
		}
	}

	public async updateServerTimeout(
		serverName: string,
		timeout: number,
		source?: "global" | "project",
	): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			// Update the server config in the appropriate file
			await this.updateServerConfig(serverName, { timeout }, connection.server.source || "global")

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} timeout settings`, error)
			throw error
		}
	}

	public async deleteServer(serverName: string, source?: "global" | "project"): Promise<void> {
		try {
			// Find the connection to determine if it's a global or project server
			const connection = this.findConnection(serverName, source)
			if (!connection) {
				throw new Error(`Server ${serverName}${source ? ` with source ${source}` : ""} not found`)
			}

			const serverSource = connection.server.source || "global"
			// Determine config file based on server source
			const isProjectServer = serverSource === "project"
			let configPath: string

			if (isProjectServer) {
				// Get project MCP config path
				const projectMcpPath = await this.getProjectMcpPath()
				if (!projectMcpPath) {
					throw new Error("Project MCP configuration file not found")
				}
				configPath = projectMcpPath
			} else {
				// Get global MCP settings path
				configPath = await this.getMcpSettingsFilePath()
			}

			// Ensure the settings file exists and is accessible
			try {
				await fs.access(configPath)
			} catch (error) {
				throw new Error("Settings file not accessible")
			}

			const content = await fs.readFile(configPath, "utf-8")
			const config = JSON.parse(content)

			// Validate the config structure
			if (!config || typeof config !== "object") {
				throw new Error("Invalid config structure")
			}

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			// Remove the server from the settings
			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]

				// Write the entire config back
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}

				await safeWriteJson(configPath, updatedConfig)

				// Update server connections with the correct source
				await this.updateServerConnections(config.mcpServers, serverSource)

				vscode.window.showInformationMessage(t("mcp:info.server_deleted", { serverName }))
			} else {
				vscode.window.showWarningMessage(t("mcp:info.server_not_found", { serverName }))
			}
		} catch (error) {
			this.showErrorMessage(`Failed to delete MCP server ${serverName}`, error)
			throw error
		}
	}

	async readResource(serverName: string, uri: string, source?: "global" | "project"): Promise<McpResourceResponse> {
		const connection = this.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		return await connection.client.request(
			{
				method: "resources/read",
				params: {
					uri,
				},
			},
			ReadResourceResultSchema,
		)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: "global" | "project",
	): Promise<McpToolCallResponse> {
		const connection = this.findConnection(serverName, source)
		if (!connection || connection.type !== "connected") {
			throw new Error(
				`No connection found for server: ${serverName}${source ? ` with source ${source}` : ""}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled and cannot be used`)
		}

		let timeout: number
		try {
			const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config))
			timeout = (parsedConfig.timeout ?? 60) * 1000
		} catch (error) {
			console.error("Failed to parse server config for timeout:", error)
			// Default to 60 seconds if parsing fails
			timeout = 60 * 1000
		}

		return await connection.client.request(
			{
				method: "tools/call",
				params: {
					name: toolName,
					arguments: toolArguments,
				},
			},
			CallToolResultSchema,
			{
				timeout,
			},
		)
	}

	/**
	 * Helper method to update a specific tool list (alwaysAllow or disabledTools)
	 * in the appropriate settings file.
	 * @param serverName The name of the server to update
	 * @param source Whether to update the global or project config
	 * @param toolName The name of the tool to add or remove
	 * @param listName The name of the list to modify ("alwaysAllow" or "disabledTools")
	 * @param addTool Whether to add (true) or remove (false) the tool from the list
	 */
	private async updateServerToolList(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		listName: "alwaysAllow" | "disabledTools",
		addTool: boolean,
	): Promise<void> {
		// Find the connection with matching name and source
		const connection = this.findConnection(serverName, source)

		if (!connection) {
			throw new Error(`Server ${serverName} with source ${source} not found`)
		}

		// Determine the correct config path based on the source
		let configPath: string
		if (source === "project") {
			// Get project MCP config path
			const projectMcpPath = await this.getProjectMcpPath()
			if (!projectMcpPath) {
				throw new Error("Project MCP configuration file not found")
			}
			configPath = projectMcpPath
		} else {
			// Get global MCP settings path
			configPath = await this.getMcpSettingsFilePath()
		}

		// Normalize path for cross-platform compatibility
		// Use a consistent path format for both reading and writing
		const normalizedPath = process.platform === "win32" ? configPath.replace(/\\/g, "/") : configPath

		// Read the appropriate config file
		const content = await fs.readFile(normalizedPath, "utf-8")
		const config = JSON.parse(content)

		if (!config.mcpServers) {
			config.mcpServers = {}
		}

		if (!config.mcpServers[serverName]) {
			config.mcpServers[serverName] = {
				type: "stdio",
				command: "node",
				args: [], // Default to an empty array; can be set later if needed
			}
		}

		if (!config.mcpServers[serverName][listName]) {
			config.mcpServers[serverName][listName] = []
		}

		const targetList = config.mcpServers[serverName][listName]
		const toolIndex = targetList.indexOf(toolName)

		if (addTool && toolIndex === -1) {
			targetList.push(toolName)
		} else if (!addTool && toolIndex !== -1) {
			targetList.splice(toolIndex, 1)
		}

		// Set flag to prevent file watcher from triggering server restart
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
		try {
			await safeWriteJson(normalizedPath, config)
		} finally {
			// Reset flag after watcher debounce period (non-blocking)
			this.flagResetTimer = setTimeout(() => {
				this.isProgrammaticUpdate = false
				this.flagResetTimer = undefined
			}, 600)
		}

		if (connection) {
			connection.server.tools = await this.fetchToolsList(serverName, source)
			await this.notifyWebviewOfServerChanges()
		}
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		shouldAllow: boolean,
	): Promise<void> {
		try {
			await this.updateServerToolList(serverName, source, toolName, "alwaysAllow", shouldAllow)
		} catch (error) {
			this.showErrorMessage(
				`Failed to toggle always allow for tool "${toolName}" on server "${serverName}" with source "${source}"`,
				error,
			)
			throw error
		}
	}

	async toggleToolEnabledForPrompt(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		isEnabled: boolean,
	): Promise<void> {
		try {
			// When isEnabled is true, we want to remove the tool from the disabledTools list.
			// When isEnabled is false, we want to add the tool to the disabledTools list.
			const addToolToDisabledList = !isEnabled
			await this.updateServerToolList(serverName, source, toolName, "disabledTools", addToolToDisabledList)
		} catch (error) {
			this.showErrorMessage(`Failed to update settings for tool ${toolName}`, error)
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	/**
	 * Handles enabling/disabling MCP globally
	 * @param enabled Whether MCP should be enabled or disabled
	 * @returns Promise<void>
	 */
	async handleMcpEnabledChange(enabled: boolean): Promise<void> {
		if (!enabled) {
			// If MCP is being disabled, disconnect all servers with error handling
			const existingConnections = [...this.connections]
			const disconnectionErrors: Array<{ serverName: string; error: string }> = []

			for (const conn of existingConnections) {
				try {
					await this.deleteConnection(conn.server.name, conn.server.source)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					disconnectionErrors.push({
						serverName: conn.server.name,
						error: errorMessage,
					})
					console.error(`Failed to disconnect MCP server ${conn.server.name}: ${errorMessage}`)
				}
			}

			// If there were errors, notify the user
			if (disconnectionErrors.length > 0) {
				const errorSummary = disconnectionErrors.map((e) => `${e.serverName}: ${e.error}`).join("\n")
				vscode.window.showWarningMessage(
					t("mcp:errors.disconnect_servers_partial", {
						count: disconnectionErrors.length,
						errors: errorSummary,
					}),
				)
			}

			// Re-initialize servers to track them in disconnected state
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after disabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_disable"))
			}
		} else {
			// If MCP is being enabled, reconnect all servers
			try {
				await this.refreshAllConnections()
			} catch (error) {
				console.error(`Failed to refresh MCP connections after enabling: ${error}`)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_enable"))
			}
		}
	}

	async dispose(): Promise<void> {
		// Prevent multiple disposals
		if (this.isDisposed) {
			return
		}

		this.isDisposed = true

		// Clear all debounce timers
		for (const timer of this.configChangeDebounceTimers.values()) {
			clearTimeout(timer)
		}

		this.configChangeDebounceTimers.clear()

		// Clear flag reset timer and reset programmatic update flag
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
			this.flagResetTimer = undefined
		}

		this.isProgrammaticUpdate = false
		// kilocode_change start: - Clear all reconnect timers
		for (const timer of this.reconnectTimers.values()) {
			clearTimeout(timer)
		}
		this.reconnectTimers.clear()
		this.reconnectAttempts.clear()
		// kilocode_change end

		this.removeAllFileWatchers()

		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name, connection.server.source)
			} catch (error) {
				console.error(`Failed to close connection for ${connection.server.name}:`, error)
			}
		}

		this.connections = []

		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		this.disposables.forEach((d) => d.dispose())
	}
}
