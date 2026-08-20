import { MCP } from "@/mcp"
import { RuntimeFlags } from "@/effect/runtime-flags" // kilocode_change
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { McpServerNotFoundError } from "../errors"
import { AddPayload, AuthCallbackPayload, StatusMap, UnsupportedOAuthError } from "../groups/mcp"
import { CallToolPayload, ReadResourcePayload } from "../groups/mcp" // kilocode_change

export const mcpHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp", (handlers) =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const flags = yield* RuntimeFlags.Service // kilocode_change

    const status = Effect.fn("McpHttpApi.status")(function* () {
      return yield* mcp.status()
    })

    const add = Effect.fn("McpHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      const result = (yield* mcp.add(ctx.payload.name, ctx.payload.config)).status
      return yield* Schema.decodeUnknownEffect(StatusMap)(
        "status" in result ? { [ctx.payload.name]: result } : result,
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const authStart = Effect.fn("McpHttpApi.authStart")(function* (ctx: { params: { name: string } }) {
      return yield* Effect.gen(function* () {
        if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp.startAuth(ctx.params.name)
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        ),
      )
    })

    const authCallback = Effect.fn("McpHttpApi.authCallback")(function* (ctx: {
      params: { name: string }
      payload: typeof AuthCallbackPayload.Type
    }) {
      return yield* mcp
        .finishAuth(ctx.params.name, ctx.payload.code)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
    })

    const authAuthenticate = Effect.fn("McpHttpApi.authAuthenticate")(function* (ctx: { params: { name: string } }) {
      return yield* Effect.gen(function* () {
        if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
          return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
        }
        return yield* mcp.authenticate(ctx.params.name)
      }).pipe(
        Effect.catchTag("MCP.NotFoundError", (error) =>
          Effect.fail(new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })),
        ),
      )
    })

    const authRemove = Effect.fn("McpHttpApi.authRemove")(function* (ctx: { params: { name: string } }) {
      const status = yield* mcp.status()
      if (!(ctx.params.name in status))
        return yield* new McpServerNotFoundError({
          name: ctx.params.name,
          message: `MCP server not found: ${ctx.params.name}`,
        })
      yield* mcp.removeAuth(ctx.params.name)
      return { success: true as const }
    })

    const connect = Effect.fn("McpHttpApi.connect")(function* (ctx: { params: { name: string } }) {
      yield* mcp
        .connect(ctx.params.name)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
      return true
    })

    const disconnect = Effect.fn("McpHttpApi.disconnect")(function* (ctx: { params: { name: string } }) {
      yield* mcp
        .disconnect(ctx.params.name)
        .pipe(
          Effect.catchTag("MCP.NotFoundError", (error) =>
            Effect.fail(
              new McpServerNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` }),
            ),
          ),
        )
      return true
    })

    // kilocode_change start - MCP Apps experimental resource/tool endpoints
    const readResource = Effect.fn("McpHttpApi.readResource")(function* (ctx: {
      payload: typeof ReadResourcePayload.Type
    }) {
      if (!flags.experimentalMcpApps) {
        return yield* Effect.fail(new HttpApiError.NotFound({}))
      }
      const result = yield* mcp.readResource(ctx.payload.server, ctx.payload.uri)
      const content = result?.contents[0]
      if (!content) {
        return yield* Effect.fail(new HttpApiError.NotFound({}))
      }
      return {
        uri: content.uri,
        ...(content.mimeType ? { mimeType: content.mimeType } : {}),
        ...("text" in content && content.text ? { text: content.text } : {}),
        ...("blob" in content && content.blob ? { blob: content.blob } : {}),
      }
    })

    const callTool = Effect.fn("McpHttpApi.callTool")(function* (ctx: {
      payload: typeof CallToolPayload.Type
    }) {
      if (!flags.experimentalMcpApps) {
        return yield* Effect.fail(new HttpApiError.NotFound({}))
      }
      const client = (yield* mcp.clients())[ctx.payload.server]
      if (!client) {
        return yield* Effect.fail(new HttpApiError.NotFound({}))
      }
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
    // kilocode_change end

    return handlers
      .handle("status", status)
      .handle("add", add)
      .handle("authStart", authStart)
      .handle("authCallback", authCallback)
      .handle("authAuthenticate", authAuthenticate)
      .handle("authRemove", authRemove)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
      .handle("readResource", readResource) // kilocode_change
      .handle("callTool", callTool) // kilocode_change
  }),
)
