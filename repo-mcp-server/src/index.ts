#!/usr/bin/env node

/**
 * Simple entry point for MCP stdio script
 * Directly runs the StdioServerTransport handler for MCP tools
 *
 * VERSION: 2023-05-25-001
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

// Import tool handlers
import { getAllTools, getToolByName } from "./tools/index.js"

// Load environment variables from root .env file
const rootEnvPath = path.resolve(process.cwd(), "../.env")
console.error(`🔍 Loading environment variables from: ${rootEnvPath}`)
dotenv.config({ path: rootEnvPath })

// Get the OpenRouter API key from environment variables
let OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""

// Use the API key as-is

// Log API key status (safely)
if (OPENROUTER_API_KEY) {
	const maskedKey =
		OPENROUTER_API_KEY.substring(0, 10) +
		"..." +
		(OPENROUTER_API_KEY.length > 20 ? OPENROUTER_API_KEY.substring(OPENROUTER_API_KEY.length - 4) : "")
	console.error(`✅ API Key found: ${maskedKey} (${OPENROUTER_API_KEY.length} chars)`)
} else {
	console.error(`❌ No API Key found in environment variables`)
}

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "anthropic/claude-3.7-sonnet"

// Validate API key and fail early if not found
if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.trim() === "") {
	console.error(`❌ ERROR: OPENROUTER_API_KEY is not set. Translation server cannot start.`)
	console.error(`❌ Please set a valid API key in process.env or in ../.env.local file`)
	process.exit(1) // Exit with error code
} else {
	console.error(`✅ OPENROUTER_API_KEY is set (${OPENROUTER_API_KEY.substring(0, 10)}...)`)
}

// Find the project root by looking for the parent directory of repo-mcp-server
// This is more reliable than checking the current working directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, "../..")

// Initialize the base paths for locales
const LOCALE_PATHS = {
	core: path.join(PROJECT_ROOT, "src/i18n/locales"),
	webview: path.join(PROJECT_ROOT, "webview-ui/src/i18n/locales"),
}

// Log important paths for debugging
console.error(`PROJECT_ROOT set to: ${PROJECT_ROOT}`)
console.error(`Core locales path: ${LOCALE_PATHS.core}`)
console.error(`Webview locales path: ${LOCALE_PATHS.webview}`)

/**
 * Main MCP handler class
 */
class McpStdioHandler {
	server: Server

	constructor() {
		// Get all tools for initial configuration
		const allTools = getAllTools()

		// Convert tools to capabilities format
		const toolCapabilities: Record<string, any> = {}

		// Add each tool to the capabilities object
		allTools.forEach((tool) => {
			toolCapabilities[tool.name] = {
				description: tool.description,
				inputSchema: tool.inputSchema,
			}
		})

		this.server = new Server(
			{
				name: "repo-mcp-server",
				version: "2023-05-25-001",
			},
			{
				capabilities: {
					tools: toolCapabilities,
				},
			},
		)

		this.setupToolHandlers()

		// Error handling
		this.server.onerror = (error) => console.error("[MCP Error]", error)

		process.on("SIGINT", async () => {
			await this.server.close()
			process.exit(0)
		})
	}

	setupToolHandlers() {
		// Get all tools for setup
		const allTools = getAllTools()

		// Register available tools
		this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: allTools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
		}))

		// Handle tool calls
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			try {
				const { name, arguments: args } = request.params

				// Pass environment variables to handlers
				const context = {
					LOCALE_PATHS,
					OPENROUTER_API_KEY,
					DEFAULT_MODEL,
				}

				// Find the requested tool
				const tool = getToolByName(name)
				if (tool) {
					return await tool.execute(args, context)
				} else {
					throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
				}
			} catch (error) {
				console.error(`[Error in ${request.params.name}]:`, error)
				return {
					content: [
						{
							type: "text",
							text: `Error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				}
			}
		})
	}

	async run() {
		console.error("=================================================")
		console.error("🚀 Starting Translation MCP Server - VERSION: 2023-05-25-001")
		console.error("=================================================")

		// Create a stdio transport
		const transport = new StdioServerTransport()

		// Set up error handler
		transport.onerror = (error) => {
			console.error("[Transport Error]", error)
		}

		// Connect the transport to the server
		await this.server.connect(transport)

		console.error("✅ MCP stdio handler is ready to process requests")

		// Get all tool names for display
		const toolNames = getAllTools()
			.map((t) => t.name)
			.join(", ")

		console.error(`📝 Available tools: ${toolNames}`)
	}
}

// Initialize and run the handler
const handler = new McpStdioHandler()
handler.run().catch(console.error)
