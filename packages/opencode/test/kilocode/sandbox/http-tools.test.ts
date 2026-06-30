import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { run, type Profile } from "@kilocode/sandbox"
import { Agent } from "@/agent/agent"
import * as ToolNetwork from "@/kilocode/sandbox/network"
import { MessageID, SessionID } from "@/session/schema"
import * as McpWebSearch from "@/tool/mcp-websearch"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { WebFetchTool } from "@/tool/webfetch"
import { testEffect } from "../../lib/effect"

const layer = Layer.mergeAll(ToolNetwork.httpLayer, Truncate.defaultLayer, Agent.defaultLayer)
const it = testEffect(layer)

const ctx = {
  sessionID: SessionID.make("ses_sandbox_network"),
  messageID: MessageID.make("msg_sandbox_network"),
  callID: "call_sandbox_network",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

function profile(mode: Profile["network"]["mode"]): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: process.cwd(), kind: "subtree" }],
      denyWrite: [],
      denyNames: [".git"],
    },
    network: { mode, allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

function serve(fetch: (request: Request) => Response) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}

const webfetch = Effect.fn("SandboxHttpToolsTest.webfetch")(function* (
  args: Tool.InferParameters<typeof WebFetchTool>,
) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

const websearch = (http: HttpClient.HttpClient, url: string) =>
  McpWebSearch.call(
    http,
    url,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    { query: "sandbox", type: "auto", numResults: 1, livecrawl: "fallback" },
    "5 seconds",
  )

describe("model HTTP tool network policy", () => {
  it.instance("allows the actual webfetch tool under an allow profile", () =>
    Effect.gen(function* () {
      const http = yield* serve(
        () => new Response("allowed tool request", { headers: { "content-type": "text/plain" } }),
      )
      const result = yield* run(
        profile("allow"),
        webfetch({ url: new URL("/allowed", http.url).toString(), format: "text" }),
      )
      expect(result.output).toBe("allowed tool request")
    }).pipe(Effect.scoped),
  )

  it.instance("denies the actual webfetch tool before it reaches the server", () => {
    let requests = 0
    return Effect.gen(function* () {
      const http = yield* serve(() => {
        requests++
        return new Response("unexpected")
      })
      const exit = yield* Effect.exit(
        run(profile("deny"), webfetch({ url: new URL("/denied", http.url).toString(), format: "text" })),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("Sandbox denied outbound network access")
      }
      expect(requests).toBe(0)
    }).pipe(Effect.scoped)
  })

  it.instance("allows the websearch provider helper under an allow profile", () =>
    Effect.gen(function* () {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "local search results" }] },
      })
      const server = yield* serve(() => new Response(payload))
      const http = yield* HttpClient.HttpClient
      const result = yield* run(profile("allow"), websearch(http, server.url.toString()))
      expect(result).toBe("local search results")
    }).pipe(Effect.scoped),
  )

  it.instance("denies the websearch provider helper before it reaches the server", () => {
    let requests = 0
    return Effect.gen(function* () {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "unexpected" }] },
      })
      const server = yield* serve(() => {
        requests++
        return new Response(payload)
      })
      const http = yield* HttpClient.HttpClient
      const exit = yield* Effect.exit(run(profile("deny"), websearch(http, server.url.toString())))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("Sandbox denied outbound network access")
      }
      expect(requests).toBe(0)
    }).pipe(Effect.scoped)
  })
})
