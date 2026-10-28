import { InputRenderable } from "@opentui/core"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { beforeEach, expect, test } from "bun:test"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const skill: KiloMarketplaceRpc.Item = {
  registry: "kilo",
  kind: "skill",
  id: "writing",
  name: "Writing Skill",
  description: "Polish documents",
  tags: ["shared-search"],
  prerequisites: ["A text editor"],
  parameters: [],
  options: [],
  author: "Skill author",
}
const mcp: KiloMarketplaceRpc.Item = {
  registry: "kilo",
  kind: "mcp",
  id: "demo",
  name: "Demo MCP",
  description: "Query the demo service",
  tags: ["shared-search"],
  prerequisites: [],
  parameters: [],
  options: [{ name: "HTTP", prerequisites: ["Network access"], parameters: [] }],
}
const record: KiloMarketplaceRpc.Installed = {
  registry: "kilo",
  kind: "mcp",
  id: "demo",
  scope: "project",
  project: directory,
  paths: ["/owned/companion"],
  config: `${directory}/kilo2.json`,
  server: "demo",
  installedAt: 1,
  status: "ready",
}

beforeEach(() => takeDraft(undefined))

async function mount(
  input: {
    width?: number
    height?: number
    records?: readonly KiloMarketplaceRpc.Installed[]
    item?: KiloMarketplaceRpc.Item
    unavailable?: boolean
    inventoryFailed?: boolean
    previewFailed?: boolean
    uninstallFailed?: boolean
    secrets?: boolean
    longPreview?: boolean
    hold?: { method: string; until: Promise<void>; initialOnly?: boolean }
    auth?: "connected" | "needs_auth" | "disabled" | "failed" | "override"
  } = {},
) {
  const calls: { method: string; path: string; body?: { input: Record<string, unknown> } }[] = []
  let records = input.records ?? [record]
  let signedIn = false
  const app = await createAppFixture({
    width: input.width ?? 120,
    height: input.height ?? 44,
    config: { animations: false },
    fetch: async (url, request) => {
      const call = {
        method: request.method,
        path: url.pathname,
        body: undefined as { input: Record<string, unknown> } | undefined,
      }
      calls.push(call)
      if (url.pathname.startsWith("/api/rpc/kilocode.marketplace/")) {
        call.body = await request.json()
        const method = url.pathname.split("/").at(-1)!
        if (input.hold?.method === method && !(input.hold.initialOnly && call.body!.input.refresh))
          await input.hold.until
        if (method === "list") {
          if (input.unavailable) return new Response("Catalog unavailable", { status: 503 })
          const item = call.body!.input.kind === "skill" ? skill : (input.item ?? mcp)
          return json({
            output: {
              items: [
                {
                  ...item,
                  name: `${input.hold?.initialOnly && call.body!.input.refresh ? "Refreshed " : ""}${item.name}`,
                },
              ],
              failures: [],
            },
          })
        }
        if (method === "installed") {
          if (input.inventoryFailed) return new Response("Inventory unavailable", { status: 503 })
          return json({ output: records })
        }
        if (method === "preview") {
          if (input.previewFailed) return new Response("Preview unavailable", { status: 503 })
          return json({
            output: {
              config: record.config,
              server: input.longPreview
                ? Array.from({ length: 80 }, (_, index) => `command argument ${index}`).join("\n")
                : '{"type":"remote","url":"https://demo.test/mcp?token=[redacted]"}',
              parameters: input.secrets ? ["API token (TOKEN)"] : [],
              secrets: input.secrets ? ["API token"] : [],
            },
          })
        }
        if (method === "install") {
          const result = { ...record, scope: call.body!.input.scope }
          return json({ output: result })
        }
        if (method === "uninstall") {
          if (input.uninstallFailed) return new Response("Installation contents are modified", { status: 409 })
          records = records.filter(
            (record) =>
              !Object.entries(call.body!.input).every(([key, value]) => record[key as keyof typeof record] === value),
          )
          return json({ output: {} })
        }
      }
      const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
      if (input.auth && url.pathname === "/api/config")
        return json([
          {
            type: "document",
            path: record.config,
            info: { mcp: { servers: { demo: { type: "remote", url: "https://demo.test/mcp" } } } },
          },
          ...(input.auth === "override"
            ? [
                {
                  type: "document",
                  path: "/other/kilo2.json",
                  info: { mcp: { servers: { demo: { type: "remote", url: "https://other.test/mcp" } } } },
                },
              ]
            : []),
        ])
      if (input.auth && url.pathname === "/api/mcp")
        return json({
          location,
          data: [
            {
              name: "demo",
              integrationID: "demo-auth",
              status:
                input.auth === "failed"
                  ? { status: "failed", error: "Transport refused" }
                  : { status: signedIn ? "connected" : input.auth === "override" ? "needs_auth" : input.auth },
            },
          ],
        })
      const integration = {
        id: "demo-auth",
        name: "Demo MCP",
        metadata: { source: "mcp" },
        methods: [{ type: "oauth", id: "demo-oauth", label: "Sign in to Demo" }],
        connections: signedIn ? [{ type: "credential", id: "shared-credential", label: "Demo" }] : [],
      }
      if (input.auth && url.pathname === "/api/integration") return json({ location, data: [integration] })
      if (input.auth && url.pathname === "/api/integration/demo-auth") return json({ location, data: integration })
      if (url.pathname === "/api/integration/demo-auth/connect/oauth")
        return json({
          location,
          data: {
            attemptID: "demo-attempt",
            mode: "auto",
            url: "https://demo.test/auth",
            instructions: "Authorize Demo",
          },
        })
      if (url.pathname === "/api/integration/demo-auth/connect/oauth/demo-attempt") {
        if (request.method === "DELETE") return new Response(null, { status: 204 })
        signedIn = true
        return json({ location, data: { status: "complete" } })
      }
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  await app.mockInput.typeText("/marketplace")
  await app.waitForFrame((frame) => frame.includes("Browse and install skills and MCP servers"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Search skills and MCPs"))
  return { ...app, calls }
}

type Fixture = Awaited<ReturnType<typeof mount>>

async function catalogActions(app: Fixture) {
  await app.waitForFrame((frame) => frame.includes("Demo MCP") || frame.includes("Secret MCP"))
  // Two controls and one skill precede the MCP row; headings are not selectable.
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Install globally"))
}

async function choose(app: Fixture, action: string) {
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText(action)
  app.mockInput.pressEnter()
}

async function preview(app: Fixture, scope = "project") {
  await catalogActions(app)
  await choose(app, scope === "global" ? "Install globally" : "Reinstall")
  await app.waitForFrame((frame) => frame.includes("Review ") && frame.includes("Config file:"))
}

test("production browser groups both kinds and selection changes details without mutation", async () => {
  await using app = await mount()
  const frame = await app.waitForFrame((frame) => frame.includes("Writing Skill") && frame.includes("Demo MCP"))
  const left = frame.split("\n").map((line) => line.split("│")[0]!.trim())
  const row = (text: string) => left.findIndex((line) => line.startsWith(text))
  expect(row("Installed")).toBeLessThan(row("All"))
  expect(row("Skills")).toBeLessThan(row("Writing Skill"))
  expect(row("Writing Skill")).toBeLessThan(row("MCPs"))
  expect(row("MCPs")).toBeLessThan(row("Demo MCP"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  await app.waitForFrame((frame) => frame.includes("Skill author"))
  app.mockInput.pressArrow("down")
  await app.waitForFrame((frame) => frame.includes("Kind: mcp") && frame.includes("Config:"))
  expect(app.calls.filter((call) => /\/(install|uninstall|preview)$/.test(call.path))).toEqual([])
  expect(
    app.calls.filter((call) => call.path === "/api/rpc/kilocode.marketplace/list").map((call) => call.body?.input.kind),
  ).toEqual(["skill", "mcp"])
  expect(app.calls.some((call) => /registries/.test(call.path))).toBe(false)
})

test("unified external search retains headings, provenance and category empty states", async () => {
  await using app = await mount()
  await app.waitForFrame((frame) => frame.includes("Writing Skill"))
  await app.mockInput.typeText("shared-search")
  const both = await app.waitForFrame((frame) => frame.includes("Writing Skill") && frame.includes("Kind: skill"))
  expect(both).toContain("Skills")
  expect(both).toContain("MCPs")
  expect(both).toContain("Demo MCP")
  app.mockInput.pressKey("u", { ctrl: true })
  await app.mockInput.typeText("Skill author")
  await app.waitForFrame((frame) => frame.includes("No mcps match") && frame.includes("Writing Skill"))
  app.mockInput.pressKey("u", { ctrl: true })
  await app.mockInput.typeText("no-such-item")
  const empty = await app.waitForFrame((frame) => frame.includes("No results."))
  expect(empty).toContain("Installed")
  expect(empty).toContain("All")
  expect(empty).toContain("Skills")
  expect(empty).toContain("MCPs")
  app.mockInput.pressKey("u", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Demo MCP") && frame.includes("Writing Skill"))
})

test("tabs filter by kind with arrow keys and list rows omit descriptions", async () => {
  await using app = await mount()
  await app.waitForFrame((frame) => frame.includes("Writing Skill") && frame.includes("Demo MCP"))
  const list = () =>
    app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.split("│")[0]!)
      .join("\n")
  expect(list()).not.toContain("Polish documents")
  expect(app.captureCharFrame()).toContain("Polish documents")
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("No installed skills"))
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("Writing Skill") && !frame.includes("Demo MCP"))
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("Demo MCP") && !frame.includes("Writing Skill"))
  app.mockInput.pressArrow("left")
  await app.waitForFrame((frame) => frame.includes("Writing Skill") && !frame.includes("Demo MCP"))
  app.mockInput.pressArrow("left")
  app.mockInput.pressArrow("left")
  await app.waitForFrame((frame) => frame.includes("Writing Skill") && frame.includes("Demo MCP"))
})

test.each([70, 107, 108, 120])("details remain accessible and layout resizes at width %s", async (width) => {
  await using app = await mount({ width })
  await app.waitForFrame((frame) => frame.includes("Writing Skill"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  await app.waitForVisualIdle()
  expect(app.captureCharFrame().includes("Skill author")).toBe(width >= 108)
  app.mockInput.pressKey("d", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Marketplace details") && frame.includes("A text editor"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Writing Skill") && !frame.includes("Marketplace details"))
  app.resize(120, 44)
  await app.waitForFrame((frame) => frame.includes("Skill author"))
  app.resize(70, 44)
  await app.waitForFrame((frame) => !frame.includes("Skill author") && frame.includes("Writing Skill"))
})

test.each([70, 120])(
  "Installed can remove an offline/delisted record with exact ownership at width %s",
  async (width) => {
    await using app = await mount({
      width,
      unavailable: true,
      records: [
        {
          ...record,
          registry: "retained-source",
          resources: [{ path: "/owned/companion", fingerprints: ["private-evidence"] }],
        },
      ],
    })
    app.mockInput.pressArrow("right")
    await app.waitForFrame((frame) => frame.includes("No installed skills") && frame.includes("demo"))
    app.mockInput.pressKey("d", { ctrl: true })
    await app.waitForFrame(
      (frame) => frame.includes("Source: retained-source") && frame.includes("Path: /owned/companion"),
    )
    expect(app.captureCharFrame()).not.toContain("private-evidence")
    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => frame.includes("No installed skills"))
    await app.waitForVisualIdle()
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Uninstall"))
    await choose(app, "Uninstall")
    await app.waitForFrame((frame) => frame.includes("Uninstall demo (project)?"))
    expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("No installed mcps") && !frame.includes("demo kilo"))
    expect(app.calls.find((call) => call.path.endsWith("/uninstall"))?.body).toEqual({
      input: { registry: "retained-source", kind: "mcp", id: "demo", scope: "project" },
    })
    expect(app.calls.filter((call) => /credential|connect\/oauth/.test(call.path))).toEqual([])
    // The All tab remains reachable even with an empty inventory.
    app.mockInput.pressArrow("left")
    await app.waitForFrame((frame) => frame.includes("No mcps available"))
  },
)

test("Installed searches available catalog names, descriptions and tags without changing ownership", async () => {
  await using app = await mount()
  await app.waitForFrame((frame) => frame.includes("Demo MCP"))
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("No installed skills"))
  for (const query of ["Demo MCP", "Query the demo service", "shared-search"]) {
    app.mockInput.pressKey("u", { ctrl: true })
    await app.mockInput.typeText(query)
    const frame = await app.waitForFrame((frame) => frame.includes(query) && frame.includes("ID: demo"))
    expect(frame).not.toContain("No mcps match")
    expect(frame).toContain("Scope: project")
  }
  expect(app.calls.filter((call) => /\/(install|uninstall|preview)$/.test(call.path))).toEqual([])
})

test("Installed keeps duplicate source/scope identities and failed removal retains records", async () => {
  await using app = await mount({
    uninstallFailed: true,
    records: [
      record,
      { ...record, scope: "global", status: "modified", pending: [{ path: "/old/skill" }] },
      { ...record, registry: "retained-source" },
    ],
  })
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("No installed skills") && frame.includes("demo"))
  await app.mockInput.typeText("global")
  await app.waitForFrame((frame) => frame.includes("Local changes are retained"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Uninstall"))
  await choose(app, "Uninstall")
  await app.waitForFrame((frame) => frame.includes("Uninstall demo (global)?"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("No installed skills") && frame.includes("409"))
  expect(app.calls.find((call) => call.path.endsWith("/uninstall"))?.body?.input.scope).toBe("global")
  expect(app.captureCharFrame()).toContain("demo")
})

test("inventory failure has refresh guidance independent of successful catalogs", async () => {
  await using app = await mount({ inventoryFailed: true })
  await app.waitForFrame(
    (frame) =>
      frame.includes("Couldn't load installations") && frame.includes("Refresh to") && frame.includes("retry."),
  )
  expect(app.captureCharFrame()).toContain("Writing Skill")
})

test("cancelled slow catalog never replaces a reopened marketplace", async () => {
  const held = Promise.withResolvers<void>()
  await using app = await mount({ hold: { method: "list", until: held.promise } })
  try {
    await app.waitForFrame((frame) => frame.includes("Loading skills"))
    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands") && !frame.includes("Loading skills"))
    await app.mockInput.typeText("/marketplace")
    await app.waitForFrame((frame) => frame.includes("Browse and install skills and MCP servers"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Loading skills"))
    held.resolve()
    await app.waitForFrame((frame) => frame.includes("Writing Skill") && frame.includes("Demo MCP"))
    expect(app.calls.filter((call) => /\/(install|uninstall)$/.test(call.path))).toEqual([])
  } finally {
    held.resolve()
  }
})

test("refresh rejects a late initial catalog and mouse movement updates details without installing", async () => {
  const held = Promise.withResolvers<void>()
  await using app = await mount({ hold: { method: "list", until: held.promise, initialOnly: true } })
  try {
    await app.waitForFrame((frame) => frame.includes("Loading skills"))
    app.mockInput.pressKey("r", { ctrl: true })
    await app.waitForFrame((frame) => frame.includes("Refreshed Writing Skill"))
    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("Refreshed Writing Skill"))
    await app.mockMouse.moveTo(lines[y]!.indexOf("Refreshed") + 2, y)
    await app.waitForFrame((frame) => frame.includes("Skill author"))
    held.resolve()
    await app.waitForVisualIdle()
    expect(app.captureCharFrame()).toContain("Refreshed Writing Skill")
    expect(app.calls.filter((call) => /\/(install|uninstall)$/.test(call.path))).toEqual([])
  } finally {
    held.resolve()
  }
})

test("skill installation requires explicit scope confirmation", async () => {
  await using app = await mount()
  await app.waitForFrame((frame) => frame.includes("Writing Skill"))
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Install globally"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Install Writing Skill (global)?"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Search skills and MCPs"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test.each(["global", "project"])("MCP %s preview warns about plaintext and requires confirmation", async (scope) => {
  await using app = await mount({ secrets: true })
  await preview(app, scope)
  const frame = await app.waitForFrame((frame) => frame.includes("plaintext"))
  expect(frame).toContain("redacted]")
  expect(frame).toContain("API token (TOKEN)")
  expect(frame.includes("gitignored")).toBe(scope === "project")
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => frame.includes("Search skills and MCPs"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test("failed MCP preview cannot install", async () => {
  await using app = await mount({ previewFailed: true })
  await catalogActions(app)
  await choose(app, "Reinstall")
  await app.waitForFrame((frame) => frame.includes("503") && frame.includes("Search skills and MCPs"))
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test.each(["missing", "incomplete", "modified"] as const)(
  "catalog actions preserve %s ownership safeguards",
  async (status) => {
    await using app = await mount({
      records: [
        {
          ...record,
          status,
          recovering: status === "incomplete",
          pending: [{ path: "/old/skill", fingerprints: ["private-evidence"] }],
        },
      ],
    })
    await catalogActions(app)
    const frame = app.captureCharFrame()
    expect(frame.includes("Repair / reinstall (project)")).toBe(status !== "modified")
    expect(frame).not.toContain("Reinstall (project)")
    await choose(app, "Details")
    await app.waitForFrame(
      (frame) => frame.includes(`Status: ${status}`) && frame.includes("Pending cleanup: /old/skill"),
    )
    expect(app.captureCharFrame()).not.toContain("private-evidence")
    expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
  },
)

test.each(["escape", "ctrl+c", "required"])("secret prompt %s cannot submit or expose a value", async (action) => {
  await using app = await mount({
    item: {
      ...mcp,
      options: [
        {
          name: "HTTP",
          prerequisites: [],
          parameters: [{ key: "TOKEN", name: "API token", optional: false, secret: true }],
        },
      ],
    },
  })
  await catalogActions(app)
  await choose(app, "Reinstall")
  await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
  if (action !== "required") await app.mockInput.typeText("never-submit-private-value")
  if (action === "escape") app.mockInput.pressEscape()
  if (action === "ctrl+c") app.mockInput.pressKey("c", { ctrl: true })
  if (action === "required") app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Search skills and MCPs"))
  expect(app.captureCharFrame()).not.toContain("never-submit-private-value")
  expect(app.calls.some((call) => /\/(preview|install)$/.test(call.path))).toBe(false)
})

test("short-terminal preview scrolls complete configuration before confirmation", async () => {
  await using app = await mount({ longPreview: true, height: 28 })
  await preview(app)
  await app.waitForFrame((frame) => frame.includes("command argument 0"))
  app.mockInput.pressKey("END")
  await app.waitForFrame((frame) => frame.includes("command argument 79"))
  expect(app.captureCharFrame()).toContain("enter")
  expect(app.calls.some((call) => call.path.endsWith("/install"))).toBe(false)
})

test("masked parameter editing rejects oversized paste and submits only the edited value", async () => {
  await using app = await mount({
    auth: "connected",
    item: {
      ...mcp,
      name: "Secret MCP",
      options: [
        {
          name: "HTTP",
          prerequisites: [],
          parameters: [{ key: "TOKEN", name: "API token", optional: false, secret: true }],
        },
      ],
    },
  })
  await catalogActions(app)
  await choose(app, "Reinstall")
  await app.waitForFrame((frame) => frame.includes("Input hidden"))
  await app.waitFor(() => app.renderer.currentFocusedRenderable?.id === "marketplace-secret")
  await app.mockInput.typeText("private-tokenX")
  await app.mockInput.pasteBracketedText("private-oversized".repeat(4096))
  await app.waitForFrame((frame) => frame.includes("Input not added"))
  expect(app.captureCharFrame()).not.toContain("private-token")
  app.mockInput.pressBackspace()
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Review Secret MCP installation"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("and connected"))
  expect(app.calls.find((call) => call.path.endsWith("/install"))?.body?.input.params).toEqual({
    TOKEN: "private-token",
  })
  expect(app.captureCharFrame()).not.toContain("private-token")
})

test.each(["connected", "disabled", "failed", "override"] as const)(
  "native MCP readiness handles %s without starting OAuth",
  async (auth) => {
    await using app = await mount({ auth })
    await preview(app)
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) =>
      frame.includes(
        auth === "connected"
          ? "and connected"
          : auth === "disabled"
            ? "is disabled"
            : auth === "failed"
              ? "Transport refused"
              : "overridden in this project",
      ),
    )
    expect(app.calls.some((call) => call.path.endsWith("/connect/oauth"))).toBe(false)
  },
)

test("native sign-in is explicit and reports the connection after successful OAuth", async () => {
  await using app = await mount({ auth: "needs_auth" })
  await preview(app)
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("This server needs sign-in"))
  expect(app.calls.some((call) => call.path.endsWith("/connect/oauth"))).toBe(false)
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("and connected"))
  expect(app.calls.filter((call) => call.path.endsWith("/connect/oauth"))).toHaveLength(1)
  expect(app.calls.some((call) => call.path.endsWith("/uninstall"))).toBe(false)
})

test.each(["install", "uninstall"])(
  "confirmed %s displays a busy state and cancellation does not start another mutation",
  async (method) => {
    const held = Promise.withResolvers<void>()
    await using app = await mount({ hold: { method, until: held.promise } })
    try {
      await catalogActions(app)
      await choose(app, method === "install" ? "Reinstall" : "Uninstall")
      await app.waitForFrame((frame) =>
        frame.includes(method === "install" ? "Review Demo MCP installation" : "Uninstall Demo MCP (project)?"),
      )
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) =>
        frame.includes(method === "install" ? "Installing Demo MCP" : "Removing Demo MCP"),
      )
      app.mockInput.pressEscape()
      await app.waitForFrame((frame) => !frame.includes("esc cancel") && frame.includes("ctrl+p commands"))
      held.resolve()
      await app.waitForVisualIdle()
      expect(app.calls.filter((call) => call.path.endsWith(`/${method}`))).toHaveLength(1)
      expect(app.captureCharFrame()).not.toContain("Search skills and MCPs")
    } finally {
      held.resolve()
    }
  },
)
