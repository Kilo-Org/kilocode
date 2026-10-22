import { InputRenderable } from "@opentui/core"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { beforeEach, expect, test } from "bun:test"
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

async function mount(installed: KiloMarketplaceRpc.Installed, result = record) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let removed = false
  const app = await createAppFixture({
    width: 120,
    height: 40,
    config: { animations: false },
    fetch: async (url, request) => {
      calls.push({ method: request.method, path: url.pathname })
      if (url.pathname.startsWith("/api/rpc/kilocode.marketplace/")) {
        calls[calls.length - 1].body = await request.json()
        const method = url.pathname.split("/").at(-1)
        if (method === "list") return json({ output: { items: [item], failures: [] } })
        if (method === "installed") return json({ output: removed ? [] : [installed] })
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
        if (method === "install") return json({ output: result })
        if (method === "uninstall") {
          removed = true
          return json({ output: {} })
        }
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
  return { ...app, calls }
}

type Fixture = Awaited<ReturnType<typeof mount>>

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

test.each(["missing", "incomplete"] as const)("%s records offer and execute repair/reinstall", async (status) => {
  await using app = await mount({ ...record, status, recovering: status === "incomplete" })
  await actions(app)
  expect(app.captureCharFrame()).toContain("Repair / reinstall (project)")
  await app.mockInput.typeText("Repair")
  await app.waitForFrame(
    (frame) => frame.includes("Repair / reinstall (project)") && !frame.includes("Install globally"),
  )
  app.mockInput.pressEnter()
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
