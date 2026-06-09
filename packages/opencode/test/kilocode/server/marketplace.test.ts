import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import * as Catalog from "@/kilocode/marketplace/catalog"
import { Server } from "@/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

const original = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = original
  Catalog.clear()
  await disposeAllInstances()
  await resetDatabase()
})

function catalog(items: { agents?: unknown[]; mcps?: unknown[]; skills?: unknown[] }) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    const body = url.endsWith("/agents") ? items.agents : url.endsWith("/mcps") ? items.mcps : items.skills
    return new Response(JSON.stringify({ items: body ?? [] }), { status: 200 })
  }) as typeof fetch
}

function req(dir: string, input: string, init?: RequestInit) {
  const separator = input.includes("?") ? "&" : "?"
  return Server.Default().app.request(`${input}${separator}directory=${encodeURIComponent(dir)}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  })
}

async function json<T>(response: Response) {
  expect(response.status).toBe(200)
  return (await response.json()) as T
}

describe("marketplace HttpApi routes", () => {
  test.serial("lists marketplace items with workspace routing", async () => {
    catalog({ agents: [], mcps: [], skills: [] })
    await using tmp = await tmpdir()

    const body = await json<{ marketplaceItems: unknown[]; marketplaceInstalledMetadata: unknown }>(
      await req(tmp.path, "/kilocode/marketplace"),
    )

    expect(body.marketplaceItems).toEqual([])
    expect(body.marketplaceInstalledMetadata).toEqual({ project: {}, global: {} })
  })

  test.serial("installs and uninstalls marketplace items with workspace routing", async () => {
    catalog({
      agents: [],
      skills: [],
      mcps: [
        {
          id: "memory",
          name: "Memory",
          description: "",
          url: "https://example.com/memory",
          content: JSON.stringify({ command: "memory", args: ["serve"] }),
        },
      ],
    })
    await using tmp = await tmpdir()

    const install = await json<{ success: boolean; slug: string }>(
      await req(tmp.path, "/kilocode/marketplace/install", {
        method: "POST",
        body: JSON.stringify({ id: "memory", type: "mcp", target: "project" }),
      }),
    )
    const file = Bun.file(path.join(tmp.path, ".kilo", "kilo.json"))
    const cfg = JSON.parse(await file.text()) as { mcp?: Record<string, unknown> }
    const uninstall = await json<{ success: boolean; slug: string }>(
      await req(tmp.path, "/kilocode/marketplace/uninstall", {
        method: "POST",
        body: JSON.stringify({ id: "memory", type: "mcp", target: "project" }),
      }),
    )

    expect(install).toEqual({ success: true, slug: "memory" })
    expect(cfg.mcp?.memory).toEqual({ type: "local", command: ["memory", "serve"] })
    expect(uninstall).toEqual({ success: true, slug: "memory" })
  })
})
