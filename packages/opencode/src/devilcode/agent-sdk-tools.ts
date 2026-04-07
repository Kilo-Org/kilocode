import z from "zod"
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import type { SdkMcpToolDefinition, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import type { Tool } from "@/tool/tool"

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

/**
 * Extract the plain shape (Record<string, ZodType>) from a Zod schema.
 * Devil tools use z.object({...}) which is a ZodObject — the Agent SDK's
 * tool() expects the raw .shape, not the ZodObject wrapper.
 *
 * If the schema is not a ZodObject, we fall back to wrapping the entire
 * schema under a single "input" key so the tool remains callable.
 */
function extractShape(schema: z.ZodType): Record<string, z.ZodType> {
  if (schema instanceof z.ZodObject) {
    return schema.shape as Record<string, z.ZodType>
  }
  // Fallback: wrap non-object schemas so the tool is still usable
  return { input: schema }
}

/**
 * Build a minimal Tool.Context stub for executing Devil tools outside
 * of a real session. The context satisfies the interface but most
 * operations (metadata, ask) are no-ops.
 */
function createStubContext(): Tool.Context {
  return {
    sessionID: "agent-sdk-stub",
    messageID: "agent-sdk-stub",
    agent: "agent-sdk",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

export type WrappedTool = {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>
}

/**
 * Wraps a Devil Tool.Info as an Agent SDK MCP tool definition.
 *
 * Initializes the tool via init(), extracts the Zod schema shape,
 * and wraps execute() into the MCP handler format.
 */
export async function wrapToolAsMcp(toolInfo: Tool.Info): Promise<WrappedTool> {
  const initialized = await toolInfo.init()
  const inputSchema = extractShape(initialized.parameters)

  const handler = async (args: Record<string, unknown>): Promise<CallToolResult> => {
    try {
      const ctx = createStubContext()
      const result = await initialized.execute(args, ctx)
      return {
        content: [{ type: "text" as const, text: result.output }],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      }
    }
  }

  return {
    name: toolInfo.id,
    description: initialized.description,
    inputSchema,
    handler,
  }
}

/**
 * Wraps multiple Devil tools and creates an in-process MCP server
 * via the Agent SDK's createSdkMcpServer().
 */
export async function createDevilToolServer(
  tools: Tool.Info[],
): Promise<McpSdkServerConfigWithInstance> {
  const wrappedTools: SdkMcpToolDefinition<any>[] = []

  for (const t of tools) {
    const wrapped = await wrapToolAsMcp(t)
    wrappedTools.push(
      tool(wrapped.name, wrapped.description, wrapped.inputSchema, wrapped.handler),
    )
  }

  return createSdkMcpServer({
    name: "devil-tools",
    tools: wrappedTools,
  })
}
