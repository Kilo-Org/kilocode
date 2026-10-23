import { InputRenderable } from "@opentui/core"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { beforeEach, expect, test } from "bun:test"
import { noTimeoutFetch } from "@opencode/util/no-timeout-fetch"
import { KiloMarketplaceRegistry } from "../../../kilo-plugin/src/marketplace/kilo"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const item: KiloMarketplaceRpc.Item = {
  registry: "kilo",
  kind: "mcp",
  id: "demo",
  name: "Demo MCP",
  description: "Marketplace regression fixture",
  tags: [],
  prerequisites: [],
  parameters: [],
  options: [{ name: "HTTP", prerequisites: [], parameters: [] }],
}

const record: KiloMarketplaceRpc.Installed = {
  registry: "kilo",
  kind: "mcp",
  id: "demo",
  scope: "project",
  project: directory,
  paths: [],
  config: `${directory}/kilo2.json`,
  server: "demo",
  installedAt: 1,
  status: "ready",
}

beforeEach(() => takeDraft(undefined))

async function mount(
  installed: KiloMarketplaceRpc.Installed,
  result = record,
  auth?: {
    status?: "needs_auth" | "connected" | "disabled" | "failed"
    delayed?: boolean
    overridden?: boolean
    outcome?: "complete" | "failed"
    afterAuth?: "failed" | "pending"
  },
  inventory?: {
    records?: readonly KiloMarketplaceRpc.Installed[]
    unavailable?: boolean
    delayed?: Promise<void>
    loadFailed?: boolean
    uninstallFailed?: boolean
    width?: number
    item?: KiloMarketplaceRpc.Item
    preview?: { server: string; parameters: string[]; secrets: string[] }
    previewFailed?: boolean
    hold?: { method: string; until: Promise<void>; ignoreAbort?: boolean }
  },
) {
  const calls: { method: string; path: string; body?: unknown; signal: AbortSignal; directory: string | null }[] = []
  const aborted: { method: string; error: DOMException }[] = []
  const completed: string[] = []
  let removed = false
  let checks = 0
  let signedIn = false
  let records = inventory?.records ?? [installed]
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const hold = inventory?.hold
  const app = await createAppFixture({
    width: inventory?.width ?? 120,
    height: 40,
    config: { animations: false },
    clientFetch: hold
      ? Object.assign(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init)
            const url = new URL(request.url)
            if (!url.pathname.startsWith("/api/rpc/kilocode.marketplace/")) return noTimeoutFetch(request)
            const method = url.pathname.split("/").at(-1)!
            calls.push({
              method: request.method,
              path: url.pathname,
              signal: request.signal,
              directory: url.searchParams.get("location[directory]"),
              body: (await request.clone().json()) as unknown,
            })
            if (
              (method === hold.method || hold.method === "*") &&
              url.searchParams.get("location[directory]") === directory
            ) {
              // Observe the client's signal, not OS-dependent propagation to the fixture's HTTP server.
              await new Promise<void>((resolve, reject) => {
                const abort = () => {
                  const error = new DOMException("Marketplace request aborted", "AbortError")
                  aborted.push({ method, error })
                  if (!hold.ignoreAbort) reject(error)
                }
                request.signal.addEventListener("abort", abort, { once: true })
                if (request.signal.aborted) abort()
                void hold.until.then(() => {
                  request.signal.removeEventListener("abort", abort)
                  resolve()
                })
              })
              // The late-success case deliberately models a transport that ignores cancellation.
              const response = await noTimeoutFetch(new Request(request, { signal: null }))
              completed.push(method)
              return response
            }
            return noTimeoutFetch(request)
          },
          { preconnect: fetch.preconnect },
        )
      : undefined,
    fetch: async (url, request) => {
      const call = {
        method: request.method,
        path: url.pathname,
        signal: request.signal,
        directory: url.searchParams.get("location[directory]"),
        body: undefined as unknown,
      }
      if (!hold || !url.pathname.startsWith("/api/rpc/kilocode.marketplace/")) calls.push(call)
      if (url.pathname.startsWith("/api/rpc/kilocode.marketplace/")) {
        call.body = await request.json()
        const method = url.pathname.split("/").at(-1)!
        if (inventory?.unavailable && (method === "list" || method === "registries"))
          return new Response("Catalog unavailable", { status: 503 })
        if (method === "list") return json({ output: { items: [inventory?.item ?? item], failures: [] } })
        if (method === "installed") {
          await inventory?.delayed
          if (inventory?.loadFailed) return new Response("Inventory unavailable", { status: 503 })
          return json({ output: inventory ? records : removed ? [] : [installed] })
        }
        if (method === "registries.set") return json({ output: [] })
        if (method === "registries")
          return json({
            output: [
              {
                id: "kilo",
                name: "Kilo",
                description: "Curated",
                kinds: ["mcp"],
                curated: true,
                searchable: false,
                enabled: true,
              },
            ],
          })
        if (method === "preview") {
          if (inventory?.previewFailed) return new Response("Preview unavailable", { status: 503 })
          return json({
            output: {
              config: record.config,
              server: '{"type":"remote","url":"https://demo.test/mcp"}',
              parameters: [],
              secrets: [],
              ...inventory?.preview,
            },
          })
        }
        if (method === "install") return json({ output: result })
        if (method === "uninstall") {
          if (inventory?.uninstallFailed) return new Response("Installation contents are modified", { status: 409 })
          const body = call.body as {
            input: Pick<KiloMarketplaceRpc.Installed, "registry" | "kind" | "id" | "scope">
          }
          records = records.filter(
            (record) =>
              !Object.entries(body.input).every(([key, value]) => record[key as keyof typeof record] === value),
          )
          removed = true
          return json({ output: {} })
        }
      }
      if (inventory?.hold && url.pathname === "/api/project")
        return json([
          {
            id: "proj_other",
            name: "Other project",
            canonical: "/tmp/other-project",
            time: { created: 1, updated: 1 },
            sandboxes: [],
          },
        ])
      if (inventory?.hold && url.pathname === "/api/location") {
        const target = url.searchParams.get("location[directory]") ?? directory
        return json({ directory: target, project: { id: "proj_test", directory: target, canonical: target } })
      }
      if (auth && url.pathname === "/api/config")
        return json([
          {
            type: "document",
            path: record.config,
            info: { mcp: { servers: { [result.server!]: { type: "remote", url: "https://demo.test/mcp" } } } },
          },
          ...(auth.overridden
            ? [
                {
                  type: "document",
                  path: "/other/kilo2.json",
                  info: { mcp: { servers: { [result.server!]: { type: "remote", url: "https://other.test/mcp" } } } },
                },
              ]
            : []),
        ])
      if (auth && url.pathname === "/api/mcp")
        return json({
          location,
          data:
            auth.delayed && checks++ < 2
              ? []
              : [
                  {
                    name: result.server,
                    status: signedIn
                      ? auth.afterAuth === "failed"
                        ? { status: "failed", error: "Transport refused" }
                        : { status: auth.afterAuth ?? "connected" }
                      : auth.status === "failed"
                        ? { status: "failed", error: "Transport refused" }
                        : { status: auth.status ?? "needs_auth", error: "Sign-in required" },
                    integrationID: "shared-integration",
                  },
                ],
        })
      const integration = {
        id: "shared-integration",
        name: "Demo MCP",
        metadata: { source: "mcp" },
        methods: [{ type: "oauth", id: "demo-oauth", label: "Sign in to Demo" }],
        connections: signedIn ? [{ type: "credential", id: "shared-credential", label: "Demo" }] : [],
      }
      if (auth && url.pathname === "/api/integration") return json({ location, data: [integration] })
      if (auth && url.pathname === "/api/integration/shared-integration") return json({ location, data: integration })
      if (auth && url.pathname === "/api/integration/shared-integration/connect/oauth") {
        return json({
          location,
          data: {
            attemptID: "demo-attempt",
            mode: "auto",
            url: "https://demo.test/auth",
            instructions: "Authorize Demo",
          },
        })
      }
      if (auth && url.pathname === "/api/integration/shared-integration/connect/oauth/demo-attempt") {
        if (request.method === "DELETE") return new Response(null, { status: 204 })
        signedIn = auth.outcome === "complete"
        return json({ location, data: { status: auth.outcome ?? "pending", message: "Authorization denied" } })
      }
      // Both server names share a credential. Uninstall must not inspect or remove it.
      if (url.pathname === "/api/mcp")
        return json({
          data: [
            { name: "demo", integrationID: "shared-integration" },
            { name: "other-project", integrationID: "shared-integration" },
          ],
        })
      if (url.pathname === "/api/integration/shared-integration")
        return json({ data: { connections: [{ type: "credential", id: "shared-credential" }] } })
      if (url.pathname === "/api/credential/shared-credential") return new Response(null, { status: 204 })
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  return { ...app, calls, aborted, completed }
}

type Fixture = Awaited<ReturnType<typeof mount>>

async function inventory(app: Fixture) {
  await app.mockInput.typeText("/marketplace")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Manage installations even"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Installed")
  app.mockInput.pressEnter()
}

async function inventoryAction(app: Fixture, action: string) {
  await app.waitForFrame((frame) => frame.includes("Marketplace: Installed"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Details") && frame.includes("Uninstall"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText(action)
  app.mockInput.pressEnter()
}

async function reinstall(app: Fixture, confirm = true) {
  await actions(app)
  await app.mockInput.typeText("Reinstall")
  await app.waitForFrame((frame) => frame.includes("Reinstall (project)") && !frame.includes("Install globally"))
  app.mockInput.pressEnter()
  if (confirm) await confirmInstall(app)
}

async function confirmInstall(app: Fixture) {
  await app.waitForFrame(
    (frame) => frame.includes("Review ") && frame.includes("installation") && frame.includes("Config file:"),
  )
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  app.mockInput.pressEnter()
}

async function signIn(app: Fixture) {
  await app.waitForFrame((frame) => frame.includes("This server needs sign-in"))
  expect(app.calls.some((call) => call.path.endsWith("/connect/oauth"))).toBe(false)
  app.mockInput.pressEnter()
}

async function actions(app: Fixture) {
  await app.mockInput.typeText("/marketplace")
  await app.waitForFrame((frame) => frame.includes("/marketplace"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("MCP Servers")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers") && frame.includes("Demo MCP"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Uninstall (project)"))
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
}

test("the production marketplace plugin registers only /marketplace without slash aliases", async () => {
  await using app = await mount(record)
  await app.mockInput.typeText("/market")
  await app.waitForFrame((frame) => frame.includes("Browse and install skills, MCP servers and agents"))
  const frame = app.captureCharFrame()
  expect(frame).toMatch(/\/marketplace\s+Browse and install/)
  expect(frame).not.toMatch(/\/market\s+Browse and install/)
  expect(frame).not.toContain("/skills-marketplace")
})

test.each([70, 120])(
  "Installed manages unavailable/delisted catalogs at width %s without catalog requests",
  async (width) => {
    await using app = await mount(
      {
        ...record,
        registry: "disabled-source",
        paths: ["/owned/companion"],
        resources: [{ path: "/owned/companion", fingerprints: ["private-evidence"] }],
      },
      record,
      undefined,
      { unavailable: true, width },
    )
    await inventory(app)
    await inventoryAction(app, "Details")
    await app.waitForFrame((frame) => frame.includes("Path: /owned/companion") && frame.includes("MCP server: demo"))
    expect(app.captureCharFrame()).not.toContain("private-evidence")
    app.mockInput.pressEscape()
    await inventoryAction(app, "Uninstall")
    await app.waitForFrame((frame) => frame.includes("Nothing installed from marketplaces"))
    expect(app.calls.find((call) => call.path.endsWith("/uninstall"))?.body).toMatchObject({
      input: { registry: "disabled-source", kind: "mcp", id: "demo", scope: "project" },
    })
    expect(
      app.calls
        .filter((call) => call.path.startsWith("/api/rpc/kilocode.marketplace/"))
        .every((call) => call.path.endsWith("/installed") || call.path.endsWith("/uninstall")),
    ).toBe(true)
    expect(app.calls.some((call) => call.method === "DELETE" && call.path.includes("credential"))).toBe(false)
  },
)

test("Installed keeps duplicate IDs separate by registry and scope", async () => {
  await using app = await mount(record, record, undefined, {
    records: [record, { ...record, scope: "global" }, { ...record, registry: "community" }],
  })
  await inventory(app)
  await app.waitForFrame((frame) => frame.includes("Marketplace: Installed") && frame.includes("community"))
  await app.mockInput.typeText("global")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("demo (kilo, global)"))
  await app.mockInput.typeText("Uninstall")
  app.mockInput.pressEnter()
  await app.waitForFrame(
    (frame) =>
      frame.includes("Marketplace: Installed") && frame.includes("community") && !frame.includes("mcp · kilo · global"),
  )
  expect(app.calls.find((call) => call.path.endsWith("/uninstall"))?.body).toMatchObject({
    input: { registry: "kilo", kind: "mcp", id: "demo", scope: "global" },
  })
})

test.each(["missing", "modified", "incomplete"] as const)(
  "Installed displays %s and pending cleanup and retains records on uninstall failure",
  async (status) => {
    await using app = await mount(
      { ...record, status, recovering: status === "incomplete", pending: [{ path: "/old/skill" }] },
      record,
      undefined,
      { uninstallFailed: true },
    )
    await inventory(app)
    await app.waitForFrame((frame) => frame.includes("Marketplace: Installed"))
    await app.mockInput.typeText(status)
    await inventoryAction(app, "Details")
    await app.waitForFrame((frame) => frame.includes(`Status: ${status}`) && frame.includes("Pending cleanup"))
    app.mockInput.pressEscape()
    await inventoryAction(app, "Uninstall")
    await app.waitForFrame((frame) => frame.includes("Marketplace: Installed") && frame.includes("409"))
    expect(app.captureCharFrame()).toContain("demo")
  },
)

test("Installed authenticates the recorded MCP without reinstalling or fetching catalogs", async () => {
  await using app = await mount(record, record, {}, { unavailable: true })
  await inventory(app)
  await inventoryAction(app, "Authentication")
  await signIn(app)
  await app.waitForFrame((frame) => frame.includes("Waiting for authorization"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("This server needs sign-in"))
  expect(
    app.calls
      .filter((call) => call.path.startsWith("/api/rpc/kilocode.marketplace/"))
      .some((call) => /\/(list|registries|install|uninstall)$/.test(call.path)),
  ).toBe(false)
})

test("Installed reports inventory errors with a retry path", async () => {
  await using app = await mount(record, record, undefined, { loadFailed: true })
  await inventory(app)
  await app.waitForFrame((frame) => frame.includes("Couldn't load installations") && frame.includes("Reopen Installed"))
})

test("Escape during delayed inventory loading does not reopen old inventory", async () => {
  const delayed = Promise.withResolvers<void>()
  await using app = await mount(record, record, undefined, { delayed: delayed.promise })
  await inventory(app)
  await app.waitForFrame((frame) => frame.includes("Loading installed items"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
  delayed.resolve()
  await app.waitForVisualIdle()
  expect(app.captureCharFrame()).not.toContain("Marketplace: Installed")
  expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
})

test.each([false, true])(
  "Escape aborts catalog loading, permits same-location reopening and suppresses late responses (ignore abort: %s)",
  async (ignoreAbort) => {
    const held = Promise.withResolvers<void>()
    await using app = await mount(record, record, undefined, {
      hold: { method: "*", until: held.promise, ignoreAbort },
    })
    try {
      await app.mockInput.typeText("/marketplace")
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
      await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
      await app.mockInput.typeText("MCP Servers")
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) => frame.includes("Loading marketplace...") && frame.includes("esc cancel"))
      await app.waitFor(
        () =>
          app.calls.filter((call) => /\/kilocode.marketplace\/(list|installed|registries)$/.test(call.path)).length ===
          3,
      )
      app.mockInput.pressEscape()
      await app.waitFor(() => app.aborted.length === 3)
      expect(app.aborted.map((call) => call.method).sort()).toEqual(["installed", "list", "registries"])
      expect(app.aborted.every((call) => call.error.name === "AbortError")).toBe(true)
      expect(
        app.calls
          .filter((call) => /\/kilocode.marketplace\/(list|installed|registries)$/.test(call.path))
          .every((call) => call.signal.aborted),
      ).toBe(true)
      await app.waitForFrame((frame) => !frame.includes("Loading marketplace...") && frame.includes("ctrl+p commands"))
      expect(app.captureCharFrame()).not.toContain("Choose which marketplaces to browse")

      await app.mockInput.typeText("/marketplace")
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
      held.resolve()
      if (ignoreAbort) await app.waitFor(() => app.completed.length === 3)
      await app.waitForVisualIdle()
      const frame = app.captureCharFrame()
      expect(frame).toContain("Choose which marketplaces to browse")
      expect(frame).not.toContain("Marketplace: MCP Servers")
      expect(frame).not.toMatch(/abort|Couldn't|Unknown error/i)
      expect(
        app.calls.filter((call) => /\/kilocode.marketplace\/(list|installed|registries)$/.test(call.path)),
      ).toHaveLength(3)
    } finally {
      held.resolve()
    }
  },
)

test("Escape from Installed selection leaves ownership untouched", async () => {
  await using app = await mount(record, record, undefined, { unavailable: true })
  await inventory(app)
  await app.waitForFrame((frame) => frame.includes("Marketplace: Installed"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
  expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
})

test.each(["missing", "incomplete"] as const)("%s records offer and execute repair/reinstall", async (status) => {
  await using app = await mount({ ...record, status, recovering: status === "incomplete" })
  await actions(app)
  expect(app.captureCharFrame()).toContain("Repair / reinstall (project)")
  await app.mockInput.typeText("Repair")
  await app.waitForFrame(
    (frame) => frame.includes("Repair / reinstall (project)") && !frame.includes("Install globally"),
  )
  app.mockInput.pressEnter()
  await confirmInstall(app)
  await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/install")))
  expect(app.calls.find((call) => call.path.endsWith("/install"))?.body).toMatchObject({
    input: { registry: "kilo", kind: "mcp", id: "demo", scope: "project", option: "HTTP", params: {} },
  })
})

test("modified records expose their state but cannot reinstall in the modified scope", async () => {
  await using app = await mount({ ...record, status: "modified" })
  await actions(app)
  const frame = app.captureCharFrame()
  expect(frame).not.toContain("Reinstall (project)")
  expect(frame).not.toContain("Repair / reinstall (project)")
  expect(frame).toContain("Install globally")
  await app.mockInput.typeText("Details")
  await app.waitForFrame((frame) => frame.includes("Details") && !frame.includes("Uninstall (project)"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Local changes are retained"))
  expect(app.captureCharFrame()).toContain("Status: modified")
  expect(app.captureCharFrame()).toContain("Local changes are retained")
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test("install displays result warnings and old-server pending cleanup without fingerprints", async () => {
  const installed = { ...record, pending: [{ path: "/obsolete/skill", fingerprints: ["private-evidence"] }] }
  await using app = await mount(installed, { ...record, warnings: ["Cleanup requires attention"] })
  await actions(app)
  expect(app.captureCharFrame()).toContain("Pending cleanup: /obsolete/skill")
  expect(app.captureCharFrame()).not.toContain("private-evidence")
  await app.mockInput.typeText("Reinstall")
  await app.waitForFrame((frame) => frame.includes("Reinstall (project)") && !frame.includes("Install globally"))
  app.mockInput.pressEnter()
  await confirmInstall(app)
  await app.waitForFrame((frame) => frame.includes("Cleanup requires attention"))
  expect(app.captureCharFrame()).toContain("Installed Demo MCP (project)")
  expect(app.captureCharFrame()).toContain("Status: ready")
})

test("uninstall retains sign-in and calls no credential or integration endpoints", async () => {
  await using app = await mount(record)
  await actions(app)
  await app.mockInput.typeText("Uninstall")
  await app.waitForFrame((frame) => frame.includes("Keeps sign-in; /mcps first"))
  const before = app.calls.length
  app.mockInput.pressEnter()
  await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/uninstall")))
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
  expect(app.calls.find((call) => call.path.endsWith("/uninstall"))?.body).toMatchObject({
    input: { registry: "kilo", kind: "mcp", id: "demo", scope: "project" },
  })
  expect(app.calls.slice(before).filter((call) => /\/api\/(mcp|integration|credential)(\/|$)/.test(call.path))).toEqual(
    [],
  )
})

test("delayed discovery uses the returned server key and offers Sign In / Skip without starting OAuth", async () => {
  await using app = await mount(record, { ...record, server: "sanitized-demo" }, { delayed: true })
  await reinstall(app)
  await app.waitForFrame((frame) => frame.includes("This server needs sign-in"))
  expect(app.captureCharFrame()).toContain("Installed sanitized-demo")
  expect(app.captureCharFrame()).toContain("Skip")
  expect(app.calls.filter((call) => call.path === "/api/mcp").length).toBeGreaterThanOrEqual(3)
  expect(app.calls.some((call) => call.path.endsWith("/connect/oauth"))).toBe(false)
  await app.mockInput.typeText("Skip")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
  expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
})

test("installed items can sign in without reinstalling; native dialog replacements stay open until cancellation", async () => {
  await using app = await mount(record, record, {})
  await actions(app)
  await app.mockInput.typeText("Manage Authentication")
  app.mockInput.pressEnter()
  await signIn(app)
  await app.waitForFrame((frame) => frame.includes("Waiting for authorization"))
  expect(app.captureCharFrame()).not.toContain("Marketplace: MCP Servers")
  expect(app.calls.filter((call) => call.path.endsWith("/connect/oauth"))).toHaveLength(1)
  app.mockInput.pressEscape()
  await app.waitFor(() => app.calls.some((call) => call.method === "DELETE" && call.path.endsWith("demo-attempt")))
  await app.waitForFrame((frame) => frame.includes("This server needs sign-in"))
  expect(app.calls.some((call) => call.path.endsWith("/install") || call.path.endsWith("/uninstall"))).toBe(false)
})

test.each(["connected", "disabled", "failed"] as const)("%s servers do not offer OAuth", async (status) => {
  await using app = await mount(record, record, { status })
  await reinstall(app)
  await app.waitForFrame((frame) =>
    frame.includes(
      status === "connected" ? "and connected" : status === "disabled" ? "is disabled" : "Transport refused",
    ),
  )
  expect(app.captureCharFrame()).not.toContain("This server needs sign-in")
  expect(app.calls.some((call) => call.path.endsWith("/connect/oauth"))).toBe(false)
})

test("a project override defers authentication instead of signing in to the wrong server", async () => {
  await using app = await mount(record, record, { overridden: true })
  await reinstall(app)
  await app.waitForFrame((frame) => frame.includes("overridden in this project"))
  expect(app.captureCharFrame()).not.toContain("Sign In")
  expect(app.calls.some((call) => call.path.endsWith("/connect/oauth"))).toBe(false)
})

test.each([undefined, "failed"] as const)(
  "OAuth completion reports native connection outcome: %s",
  async (afterAuth) => {
    await using app = await mount(record, record, { outcome: "complete", afterAuth })
    await reinstall(app)
    await signIn(app)
    await app.waitForFrame((frame) => frame.includes(afterAuth ? "Transport refused" : "and connected"))
    if (afterAuth) expect(app.captureCharFrame()).toContain("signed in")
    expect(app.calls.filter((call) => call.path.endsWith("/connect/oauth"))).toHaveLength(1)
    expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
  },
)

test("Escape during readiness keeps installation and returns to browsing without OAuth", async () => {
  await using app = await mount(record, record, { delayed: true })
  await reinstall(app)
  await app.waitForFrame((frame) => frame.includes("Checking MCP connection status"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
  expect(app.calls.some((call) => call.path.endsWith("/uninstall") || call.path.endsWith("/connect/oauth"))).toBe(false)
})

test("OAuth failure stays native, keeps installation, and allows retry", async () => {
  await using app = await mount(record, record, { outcome: "failed" })
  await reinstall(app)
  await signIn(app)
  await app.waitForFrame(
    (frame) => frame.includes("Authorization denied") && frame.includes("This server needs sign-in"),
  )
  expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
})

test("successful sign-in with a pending transport is not reported connected", async () => {
  await using app = await mount(record, record, { outcome: "complete", afterAuth: "pending" })
  await reinstall(app)
  await signIn(app)
  await app.waitForFrame((frame) => frame.includes("Checking MCP connection status"))
  // Keep the fixture's event stream alive beyond Bun's 10-second HTTP idle timeout.
  const heartbeat = setInterval(
    () => app.events.emit({ id: "evt_pending", created: 1, type: "mcp.status.changed", data: { server: "demo" } }),
    5_000,
  )
  try {
    await app.waitForFrame((frame) => frame.includes("Installed demo: signed in") && frame.includes("Check Again"), {
      maxPasses: 1200,
    })
    expect(app.captureCharFrame()).not.toContain("and connected")
  } finally {
    clearInterval(heartbeat)
  }
}, 20_000)

test("legacy curated Brave parameters reach the masked TUI through the production adapter", async () => {
  const [brave] = KiloMarketplaceRegistry.parse(
    "mcp",
    `items:
  - id: brave-search
    name: Brave Search
    description: Web and local search using Brave Search API
    content:
      - name: NPX
        prerequisites: [Node.js]
        parameters:
          - key: BRAVE_API_KEY
            name: Brave API Key
        content: |
          { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"], "env": { "BRAVE_API_KEY": "{{BRAVE_API_KEY}}" } }
`,
  )
  await using app = await mount(record, record, undefined, { item: brave.item })
  await app.mockInput.typeText("/marketplace")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
  await app.mockInput.typeText("MCP Servers")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers") && frame.includes("Brave Search"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Install globally"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Brave API Key") && frame.includes("Input hidden"))
  await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
  await app.mockInput.typeText("dummy-brave-private-key")
  await app.waitForFrame((frame) => frame.includes("**********************"))
  expect(app.captureCharFrame()).not.toContain("dummy-brave-private-key")
  expect(app.renderer.currentFocusedEditor).not.toBeInstanceOf(InputRenderable)
  app.mockInput.pressEnter()
  await confirmInstall(app)
  await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/install")))
  expect(app.calls.find((call) => call.path.endsWith("/install"))?.body).toMatchObject({
    input: { id: "brave-search", option: "NPX", params: { BRAVE_API_KEY: "dummy-brave-private-key" } },
  })
  expect(app.captureCharFrame()).not.toContain("dummy-brave-private-key")
})

test.each([70, 120])("secret parameters stay masked and submit the real edited value at width %s", async (width) => {
  await using app = await mount(
    record,
    record,
    { status: "connected" },
    {
      width,
      item: {
        ...item,
        parameters: [{ key: "public", name: "Public value", optional: false }],
        options: [
          {
            name: "HTTP",
            prerequisites: [],
            parameters: [{ key: "token", name: "API token", optional: false, secret: true }],
          },
        ],
      },
    },
  )
  await reinstall(app, false)
  await app.waitForFrame((frame) => frame.includes("Public value"))
  await app.mockInput.typeText("visible")
  expect(await app.waitForFrame((frame) => frame.includes("visible"))).toContain("visible")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("API token") && frame.includes("Input hidden"))
  await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
  await app.mockInput.typeText("discarded-secret")
  expect(app.captureCharFrame()).not.toContain("discarded-secret")
  app.mockInput.pressKey("u", { ctrl: true })
  await app.mockInput.pasteBracketedText("private-tokenX")
  await app.waitForFrame((frame) => frame.includes("**************"))
  expect(app.captureCharFrame()).not.toContain("private-token")
  app.mockInput.pressBackspace()
  app.mockInput.pressEnter()
  await confirmInstall(app)
  await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/install")))
  expect(app.calls.find((call) => call.path.endsWith("/install"))?.body).toMatchObject({
    input: { params: { public: "visible", token: "private-token" } },
  })
  expect(app.captureCharFrame()).not.toContain("private-token")
})

test.each(["cancel", "ctrl+c", "required", "optional"] as const)(
  "secret prompt handles %s without exposing input",
  async (mode) => {
    await using app = await mount(
      record,
      record,
      { status: "connected" },
      {
        item: {
          ...item,
          options: [
            {
              name: "HTTP",
              prerequisites: [],
              parameters: [{ key: "token", name: "API token", optional: mode === "optional", secret: true }],
            },
          ],
        },
      },
    )
    await reinstall(app, false)
    await app.waitForFrame((frame) => frame.includes("API token") && frame.includes("Input hidden"))
    await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
    if (mode === "cancel" || mode === "ctrl+c") {
      await app.mockInput.typeText("never-submit")
      if (mode === "cancel") app.mockInput.pressEscape()
      if (mode === "ctrl+c") app.mockInput.pressKey("c", { ctrl: true })
    }
    if (mode === "required" || mode === "optional") app.mockInput.pressEnter()
    if (mode === "optional") {
      await confirmInstall(app)
      await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/install")))
      expect(app.calls.find((call) => call.path.endsWith("/install"))?.body).toMatchObject({
        input: { params: { token: "" } },
      })
      return
    }
    await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
    expect(app.captureCharFrame()).not.toContain("never-submit")
    expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  },
)

test.each([70, 120])("oversized secret pastes are rejected without disclosure at width %s", async (width) => {
  await using app = await mount(
    record,
    record,
    { status: "connected" },
    {
      width,
      item: {
        ...item,
        options: [
          {
            name: "HTTP",
            prerequisites: [],
            parameters: [{ key: "token", name: "API token", optional: false, secret: true }],
          },
        ],
      },
    },
  )
  await reinstall(app, false)
  await app.waitForFrame((frame) => frame.includes("API token") && frame.includes("Input hidden"))
  await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
  await app.mockInput.typeText("retained-secret")
  await app.mockInput.pasteBracketedText("oversized-private-secret".repeat(10_000))
  const rejected = await app.waitForFrame((frame) => frame.includes("Limit: 4096 characters. Input not added."))
  expect(rejected).not.toContain("retained-secret")
  expect(rejected).not.toContain("oversized-private-secret")
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  app.mockInput.pressEnter()
  await confirmInstall(app)
  await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/install")))
  expect(app.calls.find((call) => call.path.endsWith("/install"))?.body).toMatchObject({
    input: { params: { token: "retained-secret" } },
  })
  expect(app.captureCharFrame()).not.toContain("retained-secret")
})

test("secret limit counts Unicode code points, bounds the mask and permits editing after rejection", async () => {
  await using app = await mount(
    record,
    record,
    { status: "connected" },
    {
      item: {
        ...item,
        options: [
          {
            name: "HTTP",
            prerequisites: [],
            parameters: [{ key: "token", name: "API token", optional: false, secret: true }],
          },
        ],
      },
    },
  )
  await reinstall(app, false)
  await app.waitForFrame((frame) => frame.includes("API token") && frame.includes("Input hidden"))
  await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
  const secret = "\u{1f512}".repeat(4096)
  await app.mockInput.pasteBracketedText(secret)
  const full = await app.waitForFrame((frame) => frame.includes("4096/4096 characters"))
  expect(full.match(/\*+/g)).toEqual(["*".repeat(32)])
  expect(full).not.toContain("\u{1f512}")
  await app.mockInput.typeText("X")
  await app.waitForFrame((frame) => frame.includes("Input not added."))
  app.mockInput.pressKey("HOME")
  app.mockInput.pressKey("DELETE")
  await app.waitForFrame((frame) => frame.includes("4095/4096 characters"))
  await app.mockInput.typeText("Y")
  await app.waitForFrame((frame) => frame.includes("4096/4096 characters"))
  app.mockInput.pressEnter()
  await confirmInstall(app)
  await app.waitFor(() => app.calls.some((call) => call.path.endsWith("/install")))
  expect(app.calls.find((call) => call.path.endsWith("/install"))?.body).toMatchObject({
    input: { params: { token: `Y${secret.slice(2)}` } },
  })
})

test.each(["list", "installed", "registries", "registries.set", "preview", "install", "uninstall"])(
  "switching locations aborts %s without error toasts or blocking a fresh marketplace",
  async (method) => {
    const held = Promise.withResolvers<void>()
    await using app = await mount(record, record, undefined, { hold: { method, until: held.promise } })
    try {
      if (method === "install" || method === "uninstall" || method === "preview") {
        await actions(app)
        await app.mockInput.typeText(method === "uninstall" ? "Uninstall" : "Reinstall")
        app.mockInput.pressEnter()
        if (method === "install") await confirmInstall(app)
      }
      if (method !== "install" && method !== "uninstall" && method !== "preview") {
        await app.mockInput.typeText("/marketplace")
        await app.waitForFrame((frame) => frame.includes("/marketplace"))
        app.mockInput.pressEnter()
        await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
        await app.mockInput.typeText(method === "list" || method === "installed" ? "MCP Servers" : "Registries")
        app.mockInput.pressEnter()
        if (method === "registries.set") {
          await app.waitForFrame((frame) => /\[on\]\s+Kilo/.test(frame))
          app.mockInput.pressEnter()
        }
      }
      await app.waitFor(() => app.calls.some((call) => call.path.endsWith(`/${method}`)))
      app.mockInput.pressKey("o", { ctrl: true })
      await app.waitForFrame((frame) => frame.includes("Other project"))
      await app.mockInput.typeText("Other project")
      app.mockInput.pressEnter()
      await app.waitFor(() =>
        app.calls.some((call) => call.path === "/api/location" && call.directory === "/tmp/other-project"),
      )
      await app.waitFor(() => app.calls.some((call) => call.path.endsWith(`/${method}`) && call.signal.aborted))
      await app.waitFor(() => app.aborted.some((call) => call.method === method))
      expect(app.aborted.find((call) => call.method === method)?.error.name).toBe("AbortError")
      expect(app.completed).not.toContain(method)
      await app.waitForVisualIdle()
      expect(app.captureCharFrame()).not.toMatch(/abort|Couldn't|Unknown error/i)
      await app.mockInput.typeText("/marketplace")
      await app.waitForFrame((frame) => frame.includes("/marketplace"))
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) => frame.includes("Choose which marketplaces to browse"))
      await app.mockInput.typeText("MCP Servers")
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers") && frame.includes("Demo MCP"))
      held.resolve()
      await app.waitForVisualIdle()
      const frame = app.captureCharFrame()
      expect(frame).not.toMatch(/abort|Couldn't|Unknown error/i)
      expect(app.calls.some((call) => call.path.endsWith("/list") && call.directory === "/tmp/other-project")).toBe(
        true,
      )
    } finally {
      held.resolve()
    }
  },
)

test.each([70, 120])(
  "MCP preview shows command, parameter names and project secret warning before install at width %s",
  async (width) => {
    await using app = await mount(record, record, undefined, {
      width,
      preview: {
        server: '{"type":"local","command":["npx","-y","community-demo"],"environment":{"TOKEN":"[redacted]"}}',
        parameters: ["API token (TOKEN)"],
        secrets: ["API token"],
      },
    })
    await reinstall(app, false)
    const frame = await app.waitForFrame(
      (frame) => frame.includes("community-") && frame.includes("demo") && frame.includes("plaintext"),
    )
    expect(frame).toContain("API token (TOKEN)")
    expect(frame).toContain("[redacted]")
    expect(frame).toContain("gitignored")
    expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
    expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  },
)

test("MCP preview must succeed before installation", async () => {
  await using app = await mount(record, record, undefined, { previewFailed: true })
  await reinstall(app, false)
  await app.waitForFrame((frame) => frame.includes("503") && frame.includes("Marketplace: MCP Servers"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test("long MCP configurations are scrollable without hiding install/cancel actions", async () => {
  await using app = await mount(record, record, undefined, {
    preview: {
      server: Array.from({ length: 80 }, (_, index) => `command argument ${index}`).join("\n"),
      parameters: ["API token (TOKEN)"],
      secrets: ["API token"],
    },
  })
  await reinstall(app, false)
  await app.waitForFrame((frame) => frame.includes("plaintext") && frame.includes("command argument 0"))
  expect(app.captureCharFrame()).toContain("enter")
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  app.mockInput.pressKey("END")
  await app.waitForFrame((frame) => frame.includes("command argument 79"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test("global MCP previews show the resolved URL without the project secret warning", async () => {
  await using app = await mount(record, record, undefined, {
    preview: {
      server: '{"type":"remote","url":"https://demo.test/mcp?token=[redacted]"}',
      parameters: ["API token (TOKEN)"],
      secrets: ["API token"],
    },
  })
  await actions(app)
  await app.mockInput.typeText("Install globally")
  app.mockInput.pressEnter()
  const frame = await app.waitForFrame(
    (frame) => frame.includes("Review Demo MCP installation") && frame.includes("redacted"),
  )
  expect(frame).toContain("https://demo.test/mcp")
  expect(frame).not.toContain("plaintext")
  expect(app.calls.find((call) => call.path.endsWith("/preview"))?.body).toMatchObject({ input: { scope: "global" } })
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Marketplace: MCP Servers"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})
