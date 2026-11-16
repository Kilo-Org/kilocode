import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Env } from "@/env"
import { MessageID, SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { WebSearchTool } from "@/tool/websearch"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(Agent.node),
    AppNodeBuilder.build(Auth.node),
    AppNodeBuilder.build(Env.node),
    AppNodeBuilder.build(Truncate.node),
    RuntimeFlags.layer({ enableParallel: true }),
  ),
)

const query = "Search query"
const ctx = {
  sessionID: SessionID.make("ses_parallel_search"),
  messageID: MessageID.make("msg_parallel_search"),
  agent: "build",
  abort: AbortSignal.any([]),
  extra: { model: { id: "display-id", api: { id: "api-id" } } },
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("Parallel websearch", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: "Search results" }] },
  })

  for (const key of [undefined, "test-key"]) {
    it.instance(
      key ? "uses bearer auth without anonymous attribution" : "uses anonymous attribution without bearer auth",
      () =>
        Effect.gen(function* () {
          const env = yield* Env.Service
          yield* env.remove("KILO_WEBSEARCH_PROVIDER")
          if (key) yield* env.set("PARALLEL_API_KEY", key)
          else yield* env.remove("PARALLEL_API_KEY")

          const client = HttpClient.make((request) =>
            Effect.sync(() => {
              expect(request.url).toBe("https://mcp.parallel.ai/mcp")
              if (key) expect(request.headers.authorization).toBe(`Bearer ${key}`)
              else expect(request.headers.authorization).toBeUndefined()
              expect(request.headers.accept).toBe("application/json, text/event-stream")
              expect(request.headers["user-agent"]).toStartWith("opencode/")
              if (request.body._tag !== "Uint8Array") throw new Error("Expected a JSON request body")
              expect(JSON.parse(new TextDecoder().decode(request.body.body))).toEqual({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                  name: "web_search",
                  arguments: {
                    objective: query,
                    search_queries: [query],
                    ...(key ? {} : { session_id: ctx.sessionID, client_model: "api-id" }),
                  },
                },
              })
              const response = new Response(`event: message\ndata: ${payload}\n\n`, {
                headers: { "content-type": "text/event-stream" },
              })
              return HttpClientResponse.fromWeb(request, response)
            }),
          )

          const info = yield* WebSearchTool.pipe(Effect.provideService(HttpClient.HttpClient, client))
          const tool = yield* info.init()
          const result = yield* tool.execute({ query }, ctx)
          expect(result.output).toBe("Search results")
          expect(result.metadata.transport).toBe("mcp-parallel")
        }),
    )
  }
})
