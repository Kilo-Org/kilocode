import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { mkdir, readFile, writeFile } from "fs/promises"
import { parse as parseJsonc } from "jsonc-parser"
import { KilocodePaths } from "../../../src/kilocode/server/httpapi/groups/kilocode"
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

async function config(dir: string) {
  for (const file of [
    path.join(dir, ".kilo", "kilo.jsonc"),
    path.join(dir, ".kilo", "kilo.json"),
    path.join(dir, "opencode.json"),
  ]) {
    const cfg = Bun.file(file)
    if (await cfg.exists()) return parseJsonc(await cfg.text())
  }
  throw new Error("missing config")
}

async function tarball(root: string) {
  const base = path.join(root, "archive")
  const source = path.join(base, "source")
  const skill = path.join(source, "skill")
  const file = path.join(source, "skill.tar.gz")
  await mkdir(skill, { recursive: true })
  await writeFile(
    path.join(skill, "SKILL.md"),
    "---\nname: marketplace-skill\ndescription: Marketplace skill\n---\n\n# Skill\n",
  )
  // Spawn tar directly (no shell) with cwd at the archive directory and bare relative names, so
  // GNU tar on Windows does not misread a `C:\...` path as a remote host.
  const proc = Bun.spawnSync(["tar", "-czf", "skill.tar.gz", "skill"], { cwd: source })
  if (proc.exitCode !== 0) throw new Error(`tar failed (${proc.exitCode}): ${proc.stderr.toString()}`)
  return `data:application/gzip;base64,${Buffer.from(await readFile(file)).toString("base64")}`
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function harness(dir: string) {
  const api = app()
  return async (method: string, route: string, body?: unknown) => {
    const response = await api.request(route, {
      method,
      headers: { "content-type": "application/json", "x-kilo-directory": dir },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    expect(response.status).toBe(200)
    return rec(await response.json())
  }
}

describe("marketplace HTTP API", () => {
  test("installs, lists, and removes project MCP and agent items", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)

    const mcp = {
      type: "mcp",
      id: "memory",
      name: "Memory",
      description: "Remember things",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({ command: "npx", args: ["server"], env: { TOKEN: "secret" } }),
    }
    const installedMcp = await json("POST", KilocodePaths.marketplaceInstall, { item: mcp, target: "project" })
    expect(installedMcp.success).toBe(true)

    const cfg = await config(tmp.path)
    expect(cfg.mcp.memory).toEqual({ type: "local", command: ["npx", "server"], environment: { TOKEN: "secret" } })

    const agent = {
      type: "agent",
      id: "reviewer",
      name: "Reviewer",
      description: "Reviews code",
      category: "development",
      content: { mode: "all", description: "Reviews code", prompt: "Review this code." },
    }
    expect((await json("POST", KilocodePaths.marketplaceInstall, { item: agent, target: "project" })).success).toBe(
      true,
    )
    expect(await Bun.file(path.join(tmp.path, ".kilo", "agents", "reviewer.md")).exists()).toBe(true)

    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('{"items":[]}')) as unknown as typeof fetch
    try {
      const listed = await json("GET", KilocodePaths.marketplaceList)
      expect(rec(rec(listed.installed).project)["mcp:memory"]).toEqual({ type: "mcp" })
      expect(rec(rec(listed.installed).project)["agent:reviewer"]).toEqual({ type: "agent" })
    } finally {
      globalThis.fetch = original
    }

    expect(
      (await json("POST", KilocodePaths.marketplaceRemove, { item: { id: "memory", type: "mcp" }, scope: "project" }))
        .success,
    ).toBe(true)
    expect(
      (
        await json("POST", KilocodePaths.marketplaceRemove, {
          item: { id: "reviewer", type: "agent" },
          scope: "project",
        })
      ).success,
    ).toBe(true)

    const removed = await config(tmp.path)
    expect(removed.mcp?.memory).toBeUndefined()
    expect(await Bun.file(path.join(tmp.path, ".kilo", "agents", "reviewer.md")).exists()).toBe(false)
  })

  // The skill install/remove path shells out to `tar`; both the fixture and installer invoke tar
  // with a relative archive name + cwd so GNU tar on Windows does not misread the `C:\` path as a host.
  test("installs, removes, and reinstalls a marketplace skill", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)
    const manifest = path.join(tmp.path, ".kilo", "skills", "marketplace-skill", "SKILL.md")

    const skill = {
      type: "skill",
      id: "marketplace-skill",
      name: "Marketplace Skill",
      displayName: "Marketplace Skill",
      description: "A skill",
      category: "development",
      displayCategory: "Development",
      githubUrl: "https://example.com",
      content: await tarball(tmp.path),
    }
    expect((await json("POST", KilocodePaths.marketplaceInstall, { item: skill, target: "project" })).success).toBe(
      true,
    )
    expect(await Bun.file(manifest).exists()).toBe(true)

    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('{"items":[]}')) as unknown as typeof fetch
    try {
      const listed = await json("GET", KilocodePaths.marketplaceList)
      expect(rec(rec(listed.installed).project)["skill:marketplace-skill"]).toEqual({ type: "skill" })
    } finally {
      globalThis.fetch = original
    }

    expect(
      (
        await json("POST", KilocodePaths.marketplaceRemove, {
          item: { id: "marketplace-skill", type: "skill" },
          scope: "project",
        })
      ).success,
    ).toBe(true)
    expect(await Bun.file(manifest).exists()).toBe(false)

    // Skill removal must delete the whole install directory, not just SKILL.md;
    // otherwise the leftover directory permanently blocks reinstalling the skill.
    expect((await json("POST", KilocodePaths.marketplaceInstall, { item: skill, target: "project" })).success).toBe(
      true,
    )
    expect(await Bun.file(manifest).exists()).toBe(true)
  })
})
