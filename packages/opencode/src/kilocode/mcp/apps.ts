import { Effect, Schema } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import type { MCP } from "@/mcp"
import type { RuntimeFlags } from "@/effect/runtime-flags"

/**
 * MCP Apps lets MCP servers advertise UI resources alongside their tools. This module owns all the
 * Kilo-specific behavior for that experimental feature so the shared upstream files only need to
 * register the endpoints and call these helpers.
 */
export namespace McpApps {
  export const ReadResourcePayload = Schema.Struct({
    uri: Schema.String,
    server: Schema.String,
  })

  export const ReadResourceContent = Schema.Struct({
    uri: Schema.String,
    mimeType: Schema.optional(Schema.String),
    text: Schema.optional(Schema.String),
    blob: Schema.optional(Schema.String),
  })

  export const CallToolPayload = Schema.Struct({
    server: Schema.String,
    name: Schema.String,
    arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  })

  export const CallToolResponse = Schema.Struct({
    content: Schema.Array(Schema.Unknown),
    isError: Schema.optional(Schema.Boolean),
    structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  })

  /** Read a resource from a connected MCP server by URI. Used by MCP Apps to load UI resources. */
  export const readResource = (mcp: MCP.Interface, flags: RuntimeFlags.Info) =>
    Effect.fn("McpHttpApi.readResource")(function* (ctx: { payload: typeof ReadResourcePayload.Type }) {
      if (!flags.experimentalMcpApps) return yield* Effect.fail(new HttpApiError.NotFound({}))
      const result = yield* mcp.readResource(ctx.payload.server, ctx.payload.uri)
      const content = result?.contents[0]
      if (!content) return yield* Effect.fail(new HttpApiError.NotFound({}))
      return {
        uri: content.uri,
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        ...("text" in content && content.text ? { text: content.text } : {}),
        ...("blob" in content && content.blob ? { blob: content.blob } : {}),
      }
    })

  /** Call a tool on a connected MCP server. Used by MCP Apps for widget-initiated tool calls. */
  export const callTool = (mcp: MCP.Interface, flags: RuntimeFlags.Info) =>
    Effect.fn("McpHttpApi.callTool")(function* (ctx: { payload: typeof CallToolPayload.Type }) {
      if (!flags.experimentalMcpApps) return yield* Effect.fail(new HttpApiError.NotFound({}))
      const client = (yield* mcp.clients())[ctx.payload.server]
      if (!client) return yield* Effect.fail(new HttpApiError.NotFound({}))
      const result = yield* Effect.tryPromise(() =>
        client.callTool({ name: ctx.payload.name, arguments: ctx.payload.arguments ?? {} }),
      ).pipe(
        Effect.tapError((err) => Effect.logError("MCP callTool failed", { error: err })),
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return {
        content: result.content ?? [],
        ...(result.isError ? { isError: true } : {}),
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      }
    })

  /**
   * Metadata a tool call should carry so hosts can preload the tool's MCP App UI resource.
   * Returns undefined when the feature is disabled or the tool advertises no UI resource.
   */
  export const toolMetadata = (entry: MCP.McpTool, flags: RuntimeFlags.Info) => {
    if (!flags.experimentalMcpApps) return undefined
    const ui = (entry.def._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
    if (!ui?.resourceUri) return undefined
    return { mcpApp: { resourceUri: ui.resourceUri, serverId: entry.clientName } }
  }
}
