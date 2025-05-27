#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { getAllTools, getToolByName } from "./tools/index.js"

try {
	const rootEnvPath = path.resolve(process.cwd(), "../.env")
	dotenv.config({ path: rootEnvPath })

	const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ""
	const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "anthropic/claude-3.7-sonnet"

	if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.trim() === "") {
		console.error(`❌ ERROR: OPENROUTER_API_KEY is not set. Translation server cannot start.`)
		process.exit(1)
	}

	const __filename = fileURLToPath(import.meta.url)
	const __dirname = path.dirname(__filename)
	const PROJECT_ROOT = path.resolve(__dirname, "../..")

	const LOCALE_PATHS = {
		core: path.join(PROJECT_ROOT, "src/i18n/locales"),
		webview: path.join(PROJECT_ROOT, "webview-ui/src/i18n/locales"),
	}

	class McpStdioHandler {
		server: Server

		constructor() {
			const allTools = getAllTools()
			const toolCapabilities: Record<string, any> = {}

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
			this.server.onerror = (error) => console.error("[MCP Error]", error)

			process.on("SIGINT", async () => {
				await this.server.close()
				process.exit(0)
			})
		}

		setupToolHandlers() {
			const allTools = getAllTools()

			this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
				tools: allTools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				})),
			}))

			this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
				const { name, arguments: args } = request.params
				const context = { LOCALE_PATHS, OPENROUTER_API_KEY, DEFAULT_MODEL }
				const tool = getToolByName(name)

				if (tool) {
					return await tool.execute(args, context)
				} else {
					throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
				}
			})
		}

		async run() {
			console.error("🚀 Starting Translation MCP Server")
			const transport = new StdioServerTransport()
			transport.onerror = (error) => console.error("[Transport Error]", error)
			await this.server.connect(transport)

			const toolNames = getAllTools()
				.map((t) => t.name)
				.join(", ")
			console.error(`📝 Available tools: ${toolNames}`)
		}
	}

	const handler = new McpStdioHandler()
	handler.run().catch(console.error)
} catch (error) {
	console.error(`[Critical Error]: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
