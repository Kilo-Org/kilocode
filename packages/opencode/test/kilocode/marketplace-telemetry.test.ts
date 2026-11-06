import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"
import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"
import { Telemetry, type MarketplaceItemProperties } from "@kilocode/kilo-telemetry"
import { KilocodePaths } from "../../src/kilocode/server/httpapi/groups/kilocode"
import * as MarketplaceTelemetry from "../../src/kilocode/marketplace/telemetry"
import * as HttpApiServer from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

type Json = Record<string, unknown>

const MCP = {
  id: "remote-docs",
  name: "Remote Docs",
  description: "Docs search",
  category: "search",
  url: "https://example.com",
  content: [{ name: "Hosted", content: JSON.stringify({ type: "remote", url: "https://example.com/{{TENANT}}/mcp" }) }],
  parameters: [{ name: "Tenant", key: "TENANT", placeholder: "acme" }],
}
const SKILL = { id: "catalog-skill", description: "A skill", category: "dev", githubUrl: "https://x", content: "x" }
const AGENT = { id: "catalog-agent", name: "Catalog Agent", description: "An agent", category: "dev", content: "x" }

// PostHog delivery is the external boundary; record what the CLI would send. The catalog is a real
// local HTTP server, like the public marketplace API.
const installed: MarketplaceItemProperties[] = []
const removed: MarketplaceItemProperties[] = []
const spies: { mockRestore(): void }[] = []
const previous = process.env.KILO_MARKETPLACE_BASE_URL
const catalog = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const kind = new URL(request.url).pathname
    if (kind === "/mcps") return Response.json({ items: [MCP] })
    if (kind === "/skills") return Response.json({ items: [SKILL] })
    if (kind === "/agents") return Response.json({ items: [AGENT] })
    return Response.json({ items: [] })
  },
})

beforeEach(() => {
  installed.length = 0
  removed.length = 0
  process.env.KILO_MARKETPLACE_BASE_URL = catalog.url.toString().replace(/\/$/, "")
  spies.push(
    spyOn(Telemetry, "isEnabled").mockReturnValue(true),
    spyOn(Telemetry, "trackMarketplaceItemInstalled").mockImplementation((props) => void installed.push(props)),
    spyOn(Telemetry, "trackMarketplaceItemRemoved").mockImplementation((props) => void removed.push(props)),
  )
})

afterAll(() => catalog.stop(true))

afterEach(async () => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  if (previous == null) delete process.env.KILO_MARKETPLACE_BASE_URL
  if (previous != null) process.env.KILO_MARKETPLACE_BASE_URL = previous
  await disposeAllInstances()
  await resetDatabase()
})

function harness(dir: string) {
  const handler = HttpRouter.toWebHandler(
    HttpApiServer.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
    { disableLogger: true },
  ).handler
  return async <T = Json>(route: string, body: unknown): Promise<T> => {
    const response = await handler(
      new Request(`http://localhost${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-kilo-directory": dir },
        body: JSON.stringify(body),
      }),
      HttpApiServer.context,
    )
    expect(response.status).toBe(200)
    return (await response.json()) as T
  }
}

// The catalog lookup runs in the background, after the response.
async function settle(list: unknown[], count = 1) {
  for (let i = 0; i < 200 && list.length < count; i++) await Bun.sleep(10)
}

describe("marketplace telemetry from the CLI", () => {
  test("reports a successful install once, without parameter values", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const post = harness(tmp.path)

    const result = await post(KilocodePaths.marketplaceInstall, {
      item: { ...MCP, type: "mcp" },
      target: "project",
      parameters: { __method: "Hosted", TENANT: "secret-tenant" },
    })

    expect(result.success).toBe(true)
    await settle(installed)
    expect(installed).toEqual([
      {
        itemId: "remote-docs",
        itemType: "mcp",
        itemName: "Remote Docs",
        target: "project",
        catalog: "custom",
        hasParameters: true,
        installationMethodName: "Hosted",
      },
    ])
    expect(JSON.stringify(installed)).not.toContain("secret-tenant")
  })

  test("reports nothing for a failed install", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const post = harness(tmp.path)

    const result = await post(KilocodePaths.marketplaceInstall, {
      item: { type: "plugin", id: "wrong-id", content: "some-package" },
      target: "project",
    })

    expect(result.success).toBe(false)
    await Bun.sleep(100)
    expect(installed).toEqual([])
  })

  test("reports a removal only for the scope that held the item, like a Settings removal", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        mcp: { "remote-docs": { type: "remote", url: "https://example.com/a/mcp" } },
      },
    })
    const post = harness(tmp.path)
    const item = { type: "mcp", id: "remote-docs" }

    // Settings removes from every scope; the global call succeeds without removing anything.
    expect((await post(KilocodePaths.marketplaceRemove, { item, scope: "project" })).success).toBe(true)
    expect((await post(KilocodePaths.marketplaceRemove, { item, scope: "global" })).success).toBe(true)
    await settle(removed)
    // Removing again succeeds but changes nothing.
    expect((await post(KilocodePaths.marketplaceRemove, { item, scope: "project" })).success).toBe(true)
    await Bun.sleep(50)

    expect(removed).toEqual([
      { itemId: "remote-docs", itemType: "mcp", itemName: "Remote Docs", target: "project", catalog: "custom" },
    ])
  })

  test("ignores removals of servers that are not catalog items", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false, lsp: false, mcp: { private: { type: "remote", url: "https://internal/mcp" } } },
    })
    const post = harness(tmp.path)

    const result = await post(KilocodePaths.marketplaceRemove, {
      item: { type: "mcp", id: "private" },
      scope: "project",
    })
    await Bun.sleep(100)

    expect(result.success).toBe(true)
    expect(removed).toEqual([])
  })

  test("reports a catalog skill removed from Settings", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const dir = path.join(tmp.path, ".kilo", "skills", "catalog-skill")
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, "SKILL.md"), "---\nname: catalog-skill\ndescription: A skill\n---\n\n# Skill\n")
    const post = harness(tmp.path)

    expect(await post<boolean>(KilocodePaths.removeSkill, { location: path.join(dir, "SKILL.md") })).toBe(true)
    await settle(removed)

    expect(removed).toEqual([
      { itemId: "catalog-skill", itemType: "skill", itemName: "Catalog Skill", target: "project", catalog: "custom" },
    ])
  })

  test("reports a catalog agent removed from Settings", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const dir = path.join(tmp.path, ".kilo", "agents")
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, "catalog-agent.md"),
      "---\ndescription: An agent\nmode: primary\n---\n\nDo things.\n",
    )
    const post = harness(tmp.path)

    expect(await post<boolean>(KilocodePaths.removeAgent, { name: "catalog-agent", scope: "project" })).toBe(true)
    await settle(removed)

    expect(removed).toEqual([
      { itemId: "catalog-agent", itemType: "agent", itemName: "Catalog Agent", target: "project", catalog: "custom" },
    ])
  })

  test("reports a removal that deleted files before failing", async () => {
    await using tmp = await tmpdir()
    const file = await skill(tmp.path)
    const run = Effect.promise(() => unlink(file)).pipe(Effect.andThen(Effect.fail("config rewrite failed")))

    const exit = await Effect.runPromiseExit(
      MarketplaceTelemetry.removal({ directory: tmp.path }, { id: "catalog-skill", type: "skill" }, run),
    )
    await settle(removed)

    expect(exit._tag).toBe("Failure")
    expect(removed.map((entry) => entry.itemId)).toEqual(["catalog-skill"])
  })

  // Both removals delete the item: whichever runs second finds nothing, so exactly one reports.
  test("counts overlapping removals of the same item once", async () => {
    await using tmp = await tmpdir()
    const file = await skill(tmp.path)
    const item = { id: "catalog-skill", type: "skill" }
    const where = { directory: tmp.path }
    const remove = Effect.promise(() => unlink(file).then(quiet, quiet))

    await Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>()
        const started = yield* Deferred.make<void>()
        const first = yield* MarketplaceTelemetry.removal(
          where,
          item,
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.andThen(remove)),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* MarketplaceTelemetry.removal(where, item, remove).pipe(Effect.forkChild)
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    )
    await settle(removed, 2)

    expect(removed.map((entry) => entry.itemId)).toEqual(["catalog-skill"])
  })

  // The first removal deletes nothing (another scope, say) and finishes; the overlapping one deletes
  // the item afterwards. Sharing the first one's snapshots would count this zero times.
  test("counts an overlapping removal that deletes after the first one finished", async () => {
    await using tmp = await tmpdir()
    const file = await skill(tmp.path)
    const item = { id: "catalog-skill", type: "skill" }
    const where = { directory: tmp.path }

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>()
        const later = yield* Deferred.make<void>()
        const started = yield* Deferred.make<void>()
        const noop = yield* MarketplaceTelemetry.removal(
          where,
          item,
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(first))),
        ).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const real = yield* MarketplaceTelemetry.removal(
          where,
          item,
          Deferred.await(later).pipe(Effect.andThen(Effect.promise(() => unlink(file)))),
        ).pipe(Effect.forkChild)
        yield* Deferred.succeed(first, undefined)
        yield* Fiber.join(noop)
        yield* Deferred.succeed(later, undefined)
        yield* Fiber.join(real)
      }),
    )
    await settle(removed)

    expect(removed.map((entry) => entry.itemId)).toEqual(["catalog-skill"])
  })
})

function quiet() {
  return undefined
}

async function skill(root: string) {
  const dir = path.join(root, ".kilo", "skills", "catalog-skill")
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, "SKILL.md")
  await writeFile(file, "---\nname: catalog-skill\ndescription: A skill\n---\n\n# Skill\n")
  return file
}
