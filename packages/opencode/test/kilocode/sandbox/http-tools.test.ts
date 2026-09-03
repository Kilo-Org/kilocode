import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { enabled, run, type Profile } from "@kilocode/sandbox"
import { Agent } from "@/agent/agent"
import { Env } from "@/env"
import * as ToolNetwork from "@/kilocode/sandbox/network"
import { BrowserOpenTool } from "@/kilocode/tool/browser-open"
import { MessageID, SessionID } from "@/session/schema"
import * as McpWebSearch from "@/tool/mcp-websearch"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { WebFetchTool } from "@/tool/webfetch"
import { testEffect } from "../../lib/effect"

const layer = Layer.mergeAll(
  ToolNetwork.httpLayer,
  AppNodeBuilder.build(Truncate.node),
  AppNodeBuilder.build(Agent.node),
  AppNodeBuilder.build(Env.node),
)
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

  it.instance("reads browser availability only from the authenticated local broker", () =>
    Effect.gen(function* () {
      let active = false
      const server = yield* serve((request) => {
        expect(new URL(request.url).pathname).toBe("/browser/status")
        expect(request.headers.get("authorization")).toBe("Bearer browser-secret")
        return Response.json({ enabled: active })
      })
      const http = yield* HttpClient.HttpClient
      expect(yield* run(profile("deny"), ToolNetwork.status(http, server.url, "browser-secret"))).toBe(false)
      active = true
      expect(yield* run(profile("deny"), ToolNetwork.status(http, server.url, "browser-secret"))).toBe(true)
      expect(yield* ToolNetwork.status(http, new URL("https://example.com"), "browser-secret")).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.instance("allows only the authenticated browser broker while keeping the tool sandboxed", () => {
    let requests = 0
    let asked = false
    return Effect.gen(function* () {
      const server = yield* serve((request) => {
        requests++
        expect(new URL(request.url).pathname).toBe("/browser/open")
        expect(request.headers.get("authorization")).toBe("Bearer browser-secret")
        return Response.json({
          browserId: "browser-test",
          sessionId: ctx.sessionID,
          status: "ready",
          url: "http://localhost:3018/",
          title: "Sandboxed browser",
          errors: 1,
          logs: ["DEMO_STARTUP_ERROR: script initialized"],
        })
      })
      const env = yield* Env.Service
      yield* env.set("KILO_BROWSER_BROKER_URL", server.url.origin)
      yield* env.set("KILO_BROWSER_BROKER_TOKEN", "browser-secret")
      const info = yield* BrowserOpenTool
      const browser = yield* info.init()
      const result = yield* run(
        profile("deny"),
        ToolNetwork.tool(
          ToolNetwork.builtin({ id: "browser_open" }),
          browser.execute(
            { url: "http://localhost:3018/" },
            {
              ...ctx,
              ask: (request) =>
                Effect.gen(function* () {
                  asked = true
                  expect(request.always).toEqual([])
                  expect(yield* enabled).toBe(true)
                }),
            },
          ),
        ),
      )
      expect(asked).toBe(true)
      expect(requests).toBe(1)
      expect(result.metadata.status).toBe("ready")
      expect(result.metadata.title).toBe("Sandboxed browser")
      expect(result.output).toContain("DEMO_STARTUP_ERROR: script initialized")
    }).pipe(Effect.scoped)
  })

  it.instance("rejects browser broker redirects without contacting their target", () => {
    let requests = 0
    return Effect.gen(function* () {
      const target = yield* serve(() => {
        requests++
        return new Response("unexpected")
      })
      const server = yield* serve(() => Response.redirect(target.url, 302))
      const env = yield* Env.Service
      yield* env.set("KILO_BROWSER_BROKER_URL", server.url.origin)
      yield* env.set("KILO_BROWSER_BROKER_TOKEN", "browser-secret")
      const info = yield* BrowserOpenTool
      const browser = yield* info.init()
      const result = yield* run(
        profile("deny"),
        ToolNetwork.tool(
          ToolNetwork.builtin({ id: "browser_open" }),
          browser.execute({ url: "http://localhost:3018/" }, ctx),
        ),
      )
      expect(requests).toBe(0)
      expect(result.metadata.status).toBe("error")
      expect(result.output).toContain("HTTP 302")
    }).pipe(Effect.scoped)
  })

  it.instance("rejects invalid application URLs before requesting permission or contacting the broker", () => {
    let requests = 0
    let asked = false
    return Effect.gen(function* () {
      const server = yield* serve(() => {
        requests++
        return new Response("unexpected")
      })
      const env = yield* Env.Service
      yield* env.set("KILO_BROWSER_BROKER_URL", server.url.origin)
      yield* env.set("KILO_BROWSER_BROKER_TOKEN", "browser-secret")
      const info = yield* BrowserOpenTool
      const browser = yield* info.init()
      for (const url of [
        "https://localhost:3018/",
        "http://example.com/",
        "http://user:secret@localhost:3018/",
        "http://[::1]:3018/",
        "http://0.0.0.0:3018/",
      ]) {
        const result = yield* run(
          profile("deny"),
          ToolNetwork.tool(
            ToolNetwork.builtin({ id: "browser_open" }),
            browser.execute(
              { url },
              {
                ...ctx,
                ask: () =>
                  Effect.sync(() => {
                    asked = true
                  }),
              },
            ),
          ),
        )
        expect(result.metadata.status).toBe("error")
      }
      expect(asked).toBe(false)
      expect(requests).toBe(0)
    }).pipe(Effect.scoped)
  })

  it.instance("returns malformed broker responses as normal tool errors", () =>
    Effect.gen(function* () {
      const server = yield* serve(() => new Response("not json", { headers: { "content-type": "application/json" } }))
      const env = yield* Env.Service
      yield* env.set("KILO_BROWSER_BROKER_URL", server.url.origin)
      yield* env.set("KILO_BROWSER_BROKER_TOKEN", "browser-secret")
      const info = yield* BrowserOpenTool
      const browser = yield* info.init()
      const result = yield* run(
        profile("deny"),
        ToolNetwork.tool(
          ToolNetwork.builtin({ id: "browser_open" }),
          browser.execute({ url: "http://localhost:3018/" }, ctx),
        ),
      )
      expect(result.title).toBe("Browser open failed")
      expect(result.metadata.status).toBe("error")
    }).pipe(Effect.scoped),
  )

  it.instance("cancels an in-flight browser broker request", () => {
    const abort = new AbortController()
    return Effect.gen(function* () {
      const server = yield* serve(() => {
        abort.abort()
        return new Response("cancelled")
      })
      const env = yield* Env.Service
      yield* env.set("KILO_BROWSER_BROKER_URL", server.url.origin)
      yield* env.set("KILO_BROWSER_BROKER_TOKEN", "browser-secret")
      const info = yield* BrowserOpenTool
      const browser = yield* info.init()
      const result = yield* run(
        profile("deny"),
        ToolNetwork.tool(
          ToolNetwork.builtin({ id: "browser_open" }),
          browser.execute({ url: "http://localhost:3018/" }, { ...ctx, abort: abort.signal }),
        ),
      )
      expect(result.metadata.status).toBe("error")
      expect(result.output).toContain("cancelled")
    }).pipe(Effect.scoped)
  })

  it.instance("rejects browser broker origins outside the injected loopback endpoint", () =>
    Effect.gen(function* () {
      const env = yield* Env.Service
      yield* env.set("KILO_BROWSER_BROKER_URL", "https://example.com")
      yield* env.set("KILO_BROWSER_BROKER_TOKEN", "browser-secret")
      const info = yield* BrowserOpenTool
      const browser = yield* info.init()
      const result = yield* run(
        profile("deny"),
        ToolNetwork.tool(
          ToolNetwork.builtin({ id: "browser_open" }),
          browser.execute({ url: "http://localhost:3018/" }, ctx),
        ),
      )
      expect(result.title).toBe("Browser unavailable")
      expect(result.metadata.status).toBe("error")
    }),
  )
})
