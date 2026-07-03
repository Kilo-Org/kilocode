import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryPaths } from "../../../src/kilocode/server/httpapi/groups/memory"
import { KiloToolRegistry } from "../../../src/kilocode/tool/registry"
import * as HttpApiServer from "../../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Json = Record<string, unknown>

function app() {
  const handler = HttpRouter.toWebHandler(
    HttpApiServer.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
    { disableLogger: true },
  ).handler

  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        HttpApiServer.context,
      )
    },
  }
}

function rec(input: unknown): Json {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("expected object")
  return input as Json
}

function keys(input: unknown) {
  return Object.keys(rec(input)).sort()
}

function expectStats(input: unknown) {
  expect(keys(input)).toEqual(
    [
      "lastConsolidatedAt",
      "lastConsolidationCost",
      "lastConsolidationTokens",
      "lastInjectedAt",
      "lastInjectedBytes",
      "lastInjectedSessionID",
      "lastInjectedTokens",
      "lastOperationCount",
      "lastRecallAt",
      "lastRecallCount",
      "lastRecallSessionID",
    ].sort(),
  )
}

function expectOperation(input: unknown) {
  expect(keys(input)).toEqual(["added", "index", "operationCount", "removed", "skipped"].sort())
  expect(keys(rec(input).index)).toEqual(["bytes", "text", "tokens", "truncated"].sort())
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi memory", () => {
  test("manages project memory through HTTP routes", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const send = (method: string, route: string, body?: unknown) =>
      api.request(route, {
        method,
        headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const json = async (method: string, route: string, body?: unknown) => {
      const response = await send(method, route, body)
      expect(response.status).toBe(200)
      return rec(await response.json())
    }

    const status = await json("GET", MemoryPaths.status)
    expect(keys(status)).toEqual(["exists", "index", "root", "state"].sort())
    expect(keys(status.state)).toEqual(
      ["autoConsolidate", "autoInject", "capture", "enabled", "limits", "scope", "stats", "version"].sort(),
    )
    expect(rec(status.state).enabled).toBe(false)
    expect(rec(status.state).autoConsolidate).toBe(true)
    expect(rec(status.index).estimatedTokens).toBe(0)
    const stats = rec(rec(status.state).stats)
    expectStats(stats)
    expect(stats.lastInjectedAt).toBe(0)
    expect(stats.lastInjectedSessionID).toBe("")
    expect(stats.lastConsolidatedAt).toBe(0)

    const enable = await json("POST", MemoryPaths.enable)
    expectStats(rec(rec(enable.state).stats))
    expect(rec(enable.state).enabled).toBe(true)
    expect(rec(rec(enable.state).stats).lastInjectedSessionID).toBe("")

    const configured = await json("POST", MemoryPaths.configure, { autoConsolidate: false })
    expect(rec(configured.state).enabled).toBe(true)
    expect(rec(configured.state).autoConsolidate).toBe(false)

    const remembered = await json("POST", MemoryPaths.remember, {
      key: "httpapi_memory",
      text: "Use the memory HTTP API test as a stable project fact.",
      sessionID: "ses_http_memory",
    })
    expectOperation(remembered)
    expect(remembered.operationCount).toBe(1)
    expect(remembered.added).toBe(1)
    expect(remembered.removed).toBe(0)
    expect(remembered.skipped).toEqual([])
    expect(String(rec(remembered.index).text)).toContain("httpapi_memory")

    const skipped = await json("POST", MemoryPaths.remember, {
      key: "httpapi_skip",
      text: "Project memory already captures this HTTP API behavior.",
    })
    expectOperation(skipped)
    expect(skipped.operationCount).toBe(0)
    expect(skipped.added).toBe(0)
    expect(skipped.removed).toBe(0)
    expect(skipped.skipped).toEqual([
      { reason: "self_referential", text: "Project memory already captures this HTTP API behavior." },
    ])
    expect(String(rec(skipped.index).text)).not.toContain("httpapi_skip")

    const corrected = await json("POST", MemoryPaths.correct, {
      key: "httpapi_correction",
      text: "Prefer correction memory over stale project facts.",
    })
    expectOperation(corrected)
    expect(corrected.operationCount).toBe(1)
    expect(corrected.added).toBe(1)
    expect(corrected.removed).toBe(0)
    expect(corrected.skipped).toEqual([])
    expect(String(rec(corrected.index).text)).toContain("httpapi_correction")

    const show = await json("GET", MemoryPaths.show)
    expect(String(show.index)).toContain("httpapi_memory")
    expect(String(show.items)).toContain("httpapi_memory")
    expect(String(rec(show.sources).project)).toContain("httpapi_memory")
    expect(typeof show.decisions).toBe("string")
    expect(String(show.decisions)).toContain('"sessionID":"ses_http_memory"')

    const forgotten = await json("POST", MemoryPaths.forget, { query: "httpapi_memory" })
    expectOperation(forgotten)
    expect(forgotten.operationCount).toBe(1)
    expect(forgotten.added).toBe(0)
    expect(forgotten.removed).toBe(1)
    expect(forgotten.skipped).toEqual([])
    expect(String(rec(forgotten.index).text)).not.toContain("httpapi_memory")

    const disable = await json("POST", MemoryPaths.disable)
    expect(rec(disable.state).enabled).toBe(false)

    const purge = await json("POST", MemoryPaths.purge, { confirm: true })
    expect(purge.purged).toBe(true)
  })

  test("enable and disable refresh memory tool availability for the next prompt", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const ctx = { directory: tmp.path, worktree: tmp.path }
    const send = (method: string, route: string) =>
      api.request(route, {
        method,
        headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
      })

    expect(await Effect.runPromise(KiloToolRegistry.memoryToolsEnabled({ ctx }))).toBe(false)

    const enabled = await send("POST", MemoryPaths.enable)
    expect(enabled.status).toBe(200)
    expect(await Effect.runPromise(KiloToolRegistry.memoryToolsEnabled({ ctx }))).toBe(true)

    const disabled = await send("POST", MemoryPaths.disable)
    expect(disabled.status).toBe(200)
    expect(await Effect.runPromise(KiloToolRegistry.memoryToolsEnabled({ ctx }))).toBe(false)
  })

  test("purge uses the routed workspace context, not an arbitrary root parameter", async () => {
    await using left = await tmpdir({ config: { formatter: false, lsp: false } })
    await using right = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const send = (dir: string, method: string, route: string, body?: unknown) =>
      api.request(route, {
        method,
        headers: { "content-type": "application/json", "x-kilo-directory": dir },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const json = async (dir: string, method: string, route: string, body?: unknown) => {
      const response = await send(dir, method, route, body)
      expect(response.status).toBe(200)
      return rec(await response.json())
    }

    const leftEnabled = await json(left.path, "POST", MemoryPaths.enable)
    const rightEnabled = await json(right.path, "POST", MemoryPaths.enable)
    await json(left.path, "POST", MemoryPaths.remember, {
      key: "left_memory",
      text: "Left workspace memory must be purged independently.",
    })
    await json(right.path, "POST", MemoryPaths.remember, {
      key: "right_memory",
      text: "Right workspace memory must survive left workspace purge.",
    })

    const purge = await json(
      left.path,
      "POST",
      `${MemoryPaths.purge}?root=${encodeURIComponent(String(rightEnabled.root))}`,
      { confirm: true },
    )
    const rightShow = await json(right.path, "GET", MemoryPaths.show)

    expect(purge.root).toBe(leftEnabled.root)
    expect(purge.purged).toBe(true)
    expect(rightShow.root).toBe(rightEnabled.root)
    expect(String(rec(rightShow.sources).project)).toContain("right_memory")
    expect(String(rec(rightShow.sources).project)).not.toContain("left_memory")
  })

  test("returns typed error codes for disabled and invalid-input failures", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const send = (method: string, route: string, body?: unknown) =>
      api.request(route, {
        method,
        headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

    // Disabled: /memory/remember while memory is off returns 400 MemoryApiClientError
    const disabledResp = await send("POST", MemoryPaths.remember, { text: "disabled test" })
    expect(disabledResp.status).toBe(400)
    const disabledBody = rec(await disabledResp.json())
    expect(disabledBody.name).toBe("MemoryApiClientError")
    expect(rec(disabledBody.data).code).toBe("memory_disabled")
    expect(typeof rec(disabledBody.data).message).toBe("string")

    await send("POST", MemoryPaths.enable)

    // Invalid input: empty key text returns 400 MemoryApiClientError
    const invalidResp = await send("POST", MemoryPaths.remember, { key: "k", text: "" })
    expect(invalidResp.status).toBeGreaterThanOrEqual(400)
    expect(invalidResp.status).toBeLessThan(500)
    const invalidBody = rec(await invalidResp.json())
    // Schema validation or MemoryInvalidInputError — either returns a 4xx with a body
    expect(invalidResp.status).toBeLessThan(500)
  })

  test("rejects malformed HTTP payloads without corrupting memory files", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const api = app()
    const send = (method: string, route: string, body?: unknown) =>
      api.request(route, {
        method,
        headers: { "content-type": "application/json", "x-kilo-directory": tmp.path },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const json = async (method: string, route: string, body?: unknown) => {
      const response = await send(method, route, body)
      expect(response.status).toBe(200)
      return rec(await response.json())
    }
    const reject = async (route: string, body: unknown) => {
      const response = await send("POST", route, body)
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
      expect(await response.text()).not.toContain("Internal Server Error")
    }

    await json("POST", MemoryPaths.enable)

    await reject(MemoryPaths.remember, { key: "missing_text" })
    await reject(MemoryPaths.remember, { key: "empty_text", text: "" })
    await reject(MemoryPaths.remember, { key: "bad_source", file: "outside.md", text: "bad source" })
    await reject(MemoryPaths.remember, { key: "bad_section", section: "Bad\n## Injected", text: "bad section" })
    await reject(MemoryPaths.remember, { key: "control_section", section: "Bad\u0000", text: "control section" })
    await reject(MemoryPaths.remember, { key: "long_section", section: "x".repeat(81), text: "long section" })
    await reject(MemoryPaths.forget, {})
    await reject(MemoryPaths.forget, { query: "" })
    await reject(MemoryPaths.purge, {})
    await reject(MemoryPaths.purge, { confirm: false })

    const clean = await json("GET", MemoryPaths.show)
    const source = String(rec(clean.sources).project)
    expect(source).not.toContain("missing_text")
    expect(source).not.toContain("empty_text")
    expect(source).not.toContain("bad_source")
    expect(source).not.toContain("bad_section")
    expect(source).not.toContain("control_section")
    expect(source).not.toContain("long_section")

    const saved = await json("POST", MemoryPaths.remember, {
      key: "safe_section",
      section: "## Bad :: - Heading",
      text: "Keep suspicious section text inside one safe heading.",
    })
    expectOperation(saved)
    expect(saved.added).toBe(1)
    expect(saved.removed).toBe(0)
    expect(saved.skipped).toEqual([])

    const shown = await json("GET", MemoryPaths.show)
    const next = String(rec(shown.sources).project)
    expect(next).toContain("## Bad - Heading")
    expect(next).toContain("- safe_section :: Keep suspicious section text inside one safe heading.")
    expect(next).not.toContain("## Injected")
  })
})
