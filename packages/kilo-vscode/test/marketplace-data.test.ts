import { describe, expect, test } from "bun:test"
import {
  createMarketplaceData,
  filterItems,
  filterOrphans,
  mergeParameters,
  needsRepair,
  orphanRecords,
  recordsFor,
  retain,
  type MarketplaceItem,
  type MarketplaceRecord,
  type MarketplaceRpc,
} from "../webview-ui/src/v2/marketplace-data"

const labels = { agent: "Agent", skill: "Skill", mcp: "MCP Server" }

function item(id: string, kind: MarketplaceItem["kind"], overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    registry: "kilo",
    kind,
    id,
    name: id,
    description: "",
    tags: [],
    prerequisites: [],
    parameters: [],
    options: [],
    ...overrides,
  }
}

function record(
  id: string,
  kind: MarketplaceRecord["kind"],
  scope: MarketplaceRecord["scope"],
  overrides: Partial<MarketplaceRecord> = {},
): MarketplaceRecord {
  return { version: 1, registry: "kilo", kind, id, scope, installedAt: 0, status: "ready", ...overrides }
}

function rpc(overrides: Partial<MarketplaceRpc> = {}): MarketplaceRpc {
  return {
    list: async (input) => ({ items: [item(`${input.kind}-one`, input.kind)], failures: [] }),
    installed: async () => [],
    preview: async () => ({ config: "", server: "", parameters: [], secrets: [] }),
    install: async (input) => record(input.id, input.kind, input.scope),
    uninstall: async () => ({}),
    ...overrides,
  }
}

describe("marketplace data", () => {
  test("loads every kind and keeps the other kinds when one fails", async () => {
    const data = createMarketplaceData({
      directory: "/tmp/project",
      rpc: rpc({
        list: async (input) => {
          if (input.kind === "mcp") throw { type: "fetch_failed", message: "offline" }
          return { items: [item(`${input.kind}-one`, input.kind)], failures: [] }
        },
      }),
    })
    await data.load()
    expect(data.items().map((entry) => entry.id).sort()).toEqual(["agent-one", "skill-one"])
    expect(data.errors()).toEqual(["mcp: offline"])
    expect(data.fetching()).toBe(false)
  })

  test("keeps catalog failures separate from the installed records", async () => {
    const data = createMarketplaceData({
      directory: "/tmp/project",
      rpc: rpc({
        list: async (input) =>
          input.kind === "skill"
            ? { items: [], failures: [{ registry: "kilo", message: "catalog cached" }] }
            : { items: [], failures: [] },
        installed: async () => [record("one", "skill", "global")],
      }),
    })
    await data.load()
    await data.refreshInstalled()
    expect(data.errors()).toEqual(["kilo: catalog cached"])
    expect(data.records()).toHaveLength(1)
    expect(data.installedError()).toBeUndefined()
  })

  test("surfaces an installed-record failure without clearing the catalog", async () => {
    const data = createMarketplaceData({
      directory: "/tmp/project",
      rpc: rpc({ installed: async () => Promise.reject(new Error("records failed")) }),
    })
    await data.load()
    await data.refreshInstalled()
    expect(data.errors()).toEqual([])
    expect(data.items().length).toBe(3)
    expect(data.installedError()).toBe("records failed")
  })

  test("installs with the item identity, then reloads the installed records", async () => {
    const calls: MarketplaceRecord[] = []
    const data = createMarketplaceData({
      directory: "/tmp/project",
      rpc: rpc({
        install: async (input) => {
          const installed = record(input.id, input.kind, input.scope)
          calls.push(installed)
          return installed
        },
        installed: async () => calls,
      }),
    })
    const installed = await data.install(item("reviewer", "agent"), { scope: "project" })
    expect(installed.id).toBe("reviewer")
    expect(data.records()).toEqual(calls)
  })

  test("uninstalls the record in its own scope and reloads", async () => {
    const calls: string[] = []
    const data = createMarketplaceData({
      directory: "/tmp/project",
      rpc: rpc({
        uninstall: async (input) => {
          calls.push(`${input.kind}:${input.id}:${input.scope}`)
          return {}
        },
        installed: async () => [],
      }),
    })
    await data.uninstall(record("docs", "mcp", "global"))
    expect(calls).toEqual(["mcp:docs:global"])
    expect(data.records()).toEqual([])
  })

  test("joins records by registry, kind and id", () => {
    const kilo = item("docs", "skill")
    const other = item("docs", "skill", { registry: "community" })
    const records = [record("docs", "skill", "project"), record("docs", "skill", "global", { registry: "community" })]
    expect(recordsFor(records, kilo).map((entry) => entry.scope)).toEqual(["project"])
    expect(recordsFor(records, other).map((entry) => entry.scope)).toEqual(["global"])
  })

  test("filters by status, kind category and search", () => {
    const items = [
      item("reviewer", "agent", { name: "Reviewer", category: "quality" }),
      item("docs", "mcp", { name: "Docs", category: "docs" }),
      item("planner", "skill", { name: "Planner", tags: ["planning"] }),
    ]
    const records = [record("reviewer", "agent", "global")]
    expect(filterItems(items, records, "", "installed", [], [], labels).map((entry) => entry.id)).toEqual([
      "reviewer",
    ])
    expect(filterItems(items, records, "", "notInstalled", [], [], labels).map((entry) => entry.id)).toEqual([
      "docs",
      "planner",
    ])
    expect(filterItems(items, records, "", "all", ["docs"], [], labels).map((entry) => entry.id)).toEqual(["docs"])
    expect(filterItems(items, records, "", "all", [], ["agent"], labels).map((entry) => entry.id)).toEqual([
      "reviewer",
    ])
    expect(filterItems(items, records, "planning", "all", [], [], labels).map((entry) => entry.id)).toEqual([
      "planner",
    ])
    expect(filterItems(items, records, "MCP", "all", [], [], labels).map((entry) => entry.id)).toEqual(["docs"])
  })

  test("lists installed records whose catalog item is gone", () => {
    const items = [item("reviewer", "agent")]
    const records = [record("reviewer", "agent", "global"), record("orphan", "mcp", "project")]
    expect(orphanRecords(records, items).map((entry) => entry.id)).toEqual(["orphan"])
    expect(filterOrphans(records, items, "", "installed", []).map((entry) => entry.id)).toEqual(["orphan"])
    expect(filterOrphans(records, items, "orph", "all", ["mcp"]).map((entry) => entry.id)).toEqual(["orphan"])
    expect(filterOrphans(records, items, "", "notInstalled", [])).toEqual([])
  })

  test("merges shared parameters with the selected option, letting the option win", () => {
    const entry = item("docs", "mcp", {
      parameters: [{ key: "token", name: "Token", optional: false }],
      options: [
        {
          name: "remote",
          prerequisites: [],
          parameters: [
            { key: "token", name: "Access token", optional: false, secret: true },
            { key: "url", name: "URL", optional: true },
          ],
        },
      ],
    })
    expect(mergeParameters(entry, entry.options[0]).map((parameter) => `${parameter.key}:${parameter.name}`)).toEqual([
      "token:Access token",
      "url:URL",
    ])
  })

  test("repairs every installation that is not ready", () => {
    expect(needsRepair(record("one", "skill", "global"))).toBe(false)
    expect(needsRepair(record("one", "skill", "global", { status: "missing" }))).toBe(true)
    expect(needsRepair(record("one", "skill", "global", { status: "modified" }))).toBe(true)
    expect(needsRepair(record("one", "skill", "global", { status: "incomplete" }))).toBe(true)
    expect(needsRepair(record("one", "skill", "global", { status: undefined, recovering: true }))).toBe(true)
  })

  test("drops selected filters that the catalog no longer offers", () => {
    expect(retain(["agent", "mcp"], ["agent"])).toEqual(["agent"])
    expect(retain(["agent"], ["agent", "mcp"])).toEqual(["agent"])
  })
})
