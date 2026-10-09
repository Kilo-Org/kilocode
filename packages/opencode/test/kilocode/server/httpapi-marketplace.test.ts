import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { mkdir, readFile, writeFile } from "fs/promises"
import { parse as parseJsonc } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { KilocodePaths } from "../../../src/kilocode/server/httpapi/groups/kilocode"
import { detect } from "../../../src/kilocode/marketplace/detection"
import * as HttpApiServer from "../../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

const posix = process.platform === "win32" ? test.skip : test

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

async function tarball(root: string, name = "marketplace-skill") {
  const base = path.join(root, "archive")
  const source = path.join(base, "source")
  const skill = path.join(source, name)
  const file = path.join(source, `${name}.tar.gz`)
  await mkdir(skill, { recursive: true })
  await writeFile(path.join(skill, "SKILL.md"), `---\nname: ${name}\ndescription: Marketplace skill\n---\n\n# Skill\n`)
  await writeFile(path.join(skill, "reference.txt"), "Companion reference material\n")
  // Spawn tar directly (no shell) with cwd at the archive directory and bare relative names, so
  // GNU tar on Windows does not misread a `C:\...` path as a remote host.
  const proc = Bun.spawnSync(["tar", "-czf", `${name}.tar.gz`, name], { cwd: source })
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

  // The install payload only models identity and content, so a client that keeps a
  // lean catalog model can install without echoing back presentation fields. The
  // full-catalog-entry payload used by the test above must stay accepted too.
  test("installs from an identity and content payload", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)

    const installed = await json("POST", KilocodePaths.marketplaceInstall, {
      item: { type: "mcp", id: "memory", content: JSON.stringify({ command: "npx", args: ["server"] }) },
      target: "project",
    })
    expect(installed.success).toBe(true)

    const cfg = await config(tmp.path)
    expect(cfg.mcp.memory).toEqual({ type: "local", command: ["npx", "server"] })

    const agent = await json("POST", KilocodePaths.marketplaceInstall, {
      item: {
        type: "agent",
        id: "reviewer",
        content: { mode: "all", description: "Reviews code", prompt: "Review this code." },
      },
      target: "project",
    })
    expect(agent.success).toBe(true)
    expect(await Bun.file(path.join(tmp.path, ".kilo", "agents", "reviewer.md")).exists()).toBe(true)
  })

  // The skill install/remove path shells out to `tar`; keep this POSIX-only because
  // Windows runners do not consistently provide tar with the same extraction behavior.
  posix("installs, removes, and reinstalls a marketplace skill", async () => {
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

  posix("installs a remote catalog MCP with skills and removes it without the catalog", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)
    const content = await tarball(tmp.path, "remote-workflow")
    const bytes = Buffer.from(content.slice(content.indexOf(",") + 1), "base64")
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/remote-workflow.tar.gz") return new Response(bytes)
        if (url.pathname !== "/mcps") return Response.json({ items: [] })
        return Response.json({
          items: [
            {
              id: "remote-bundle",
              name: "Remote Bundle",
              description: "A remote server with its workflow",
              category: "development",
              url: "https://example.com",
              content: JSON.stringify({ type: "remote", url: "https://example.com/mcp", enabled: false }),
              skills: [{ id: "remote-workflow", content: `${url.origin}/remote-workflow.tar.gz` }],
            },
          ],
        })
      },
    })
    const previous = process.env.KILO_MARKETPLACE_BASE_URL
    process.env.KILO_MARKETPLACE_BASE_URL = server.url.toString().replace(/\/$/, "")
    try {
      const catalog = await json("GET", KilocodePaths.marketplaceList)
      const item = (catalog.items as Json[]).find((item) => item.id === "remote-bundle")
      expect(item?.skills).toEqual([{ id: "remote-workflow", content: `${server.url}remote-workflow.tar.gz` }])

      const installed = await json("POST", KilocodePaths.marketplaceInstall, { item, target: "project" })
      const file = path.join(tmp.path, ".kilo", "skills", "remote-workflow", "SKILL.md")
      expect(installed).toMatchObject({ success: true })
      expect(installed.filePaths).toContain(file)
      expect(installed.filePaths).toContain(path.join(tmp.path, "opencode.json"))
      expect((await config(tmp.path)).mcp["remote-bundle"].type).toBe("remote")
      expect(await Bun.file(path.join(path.dirname(file), "reference.txt")).text()).toContain("Companion reference")
      const listed = await json("GET", KilocodePaths.marketplaceList)
      expect(rec(rec(listed.installed).project)["skill:remote-workflow"]).toEqual({ type: "skill" })
      const response = await app().request("/skill", { headers: { "x-kilo-directory": tmp.path } })
      expect(response.status).toBe(200)
      const skills = (await response.json()) as Json[]
      expect(skills.find((skill) => skill.name === "remote-workflow")?.content).toContain("# Skill")

      await server.stop(true)
      const removed = await json("POST", KilocodePaths.marketplaceRemove, {
        item: { type: "mcp", id: "remote-bundle" },
        scope: "project",
      })
      expect(removed.success).toBe(true)
      expect(await Bun.file(file).exists()).toBe(false)
      expect((await config(tmp.path)).mcp?.["remote-bundle"]).toBeUndefined()
      expect(
        (
          await json("POST", KilocodePaths.marketplaceRemove, {
            item: { type: "mcp", id: "remote-bundle" },
            scope: "project",
          })
        ).success,
      ).toBe(true)
    } finally {
      await server.stop(true)
      if (previous == null) delete process.env.KILO_MARKETPLACE_BASE_URL
      if (previous != null) process.env.KILO_MARKETPLACE_BASE_URL = previous
    }
  })

  posix("rolls back a bundle when a companion archive fails and allows retry", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)
    const skill = { id: "bundle-valid", content: await tarball(tmp.path, "bundle-valid") }
    const item = {
      type: "mcp",
      id: "broken-bundle",
      content: JSON.stringify({ type: "remote", url: "https://example.com/mcp", enabled: false }),
      skills: [skill, { id: "bundle-broken", content: "data:application/gzip;base64,bm90IGEgdGFy" }],
    }
    const failed = await json("POST", KilocodePaths.marketplaceInstall, { item, target: "project" })
    expect(failed.success).toBe(false)
    expect((await config(tmp.path)).mcp?.[item.id]).toBeUndefined()
    expect(await Bun.file(path.join(tmp.path, ".kilo", "skills", skill.id, "SKILL.md")).exists()).toBe(false)
    expect(await json("POST", KilocodePaths.marketplaceInstall, { item: { ...item, skills: [skill] } })).toMatchObject({
      success: true,
    })
  })

  posix("does not overwrite or remove an independently installed companion skill", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)
    const skill = {
      type: "skill",
      id: "independent-workflow",
      content: await tarball(tmp.path, "independent-workflow"),
    }
    const file = path.join(tmp.path, ".kilo", "skills", skill.id, "SKILL.md")
    expect((await json("POST", KilocodePaths.marketplaceInstall, { item: skill })).success).toBe(true)
    const before = await Bun.file(file).text()
    const item = {
      type: "mcp",
      id: "independent-bundle",
      content: JSON.stringify({ type: "remote", url: "https://example.com/mcp", enabled: false }),
      skills: [{ id: skill.id, content: skill.content }],
    }
    expect((await json("POST", KilocodePaths.marketplaceInstall, { item })).success).toBe(false)
    expect((await config(tmp.path)).mcp?.[item.id]).toBeUndefined()
    expect(
      (await json("POST", KilocodePaths.marketplaceRemove, { item: { type: "mcp", id: item.id }, scope: "project" }))
        .success,
    ).toBe(true)
    expect(await Bun.file(file).text()).toBe(before)
  })

  posix("keeps global and project companion ownership separate", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)
    const skill = { id: "scoped-workflow", content: await tarball(tmp.path, "scoped-workflow") }
    const item = {
      type: "mcp",
      id: "scoped-bundle",
      content: JSON.stringify({ type: "remote", url: "https://example.com/mcp", enabled: false }),
      skills: [skill],
    }
    const project = path.join(tmp.path, ".kilo", "skills", skill.id, "SKILL.md")
    const global = path.join(Global.Path.home, ".kilo", "skills", skill.id, "SKILL.md")
    for (const target of ["project", "global"]) {
      expect(await json("POST", KilocodePaths.marketplaceInstall, { item, target })).toMatchObject({ success: true })
    }
    expect(
      (await json("POST", KilocodePaths.marketplaceRemove, { item: { id: item.id, type: "mcp" }, scope: "project" }))
        .success,
    ).toBe(true)
    expect(await Bun.file(project).exists()).toBe(false)
    expect(await Bun.file(global).exists()).toBe(true)
    expect(
      (await json("POST", KilocodePaths.marketplaceRemove, { item: { id: item.id, type: "mcp" }, scope: "global" }))
        .success,
    ).toBe(true)
    expect(await Bun.file(global).exists()).toBe(false)
  })

  posix("keeps a bundle removable when its MCP config entry is already gone", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const json = harness(tmp.path)
    const item = {
      type: "mcp",
      id: "recoverable-bundle",
      content: JSON.stringify({ type: "remote", url: "https://example.com/mcp", enabled: false }),
      skills: [{ id: "recoverable-workflow", content: await tarball(tmp.path, "recoverable-workflow") }],
    }
    expect(await json("POST", KilocodePaths.marketplaceInstall, { item })).toMatchObject({ success: true })
    const cfg = await config(tmp.path)
    delete cfg.mcp[item.id]
    await writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify(cfg))
    await disposeAllInstances()

    expect((await detect({ directory: tmp.path })).project[`mcp:${item.id}`]).toEqual({ type: "mcp" })
    expect(
      await json("POST", KilocodePaths.marketplaceRemove, { item: { type: "mcp", id: item.id }, scope: "project" }),
    ).toMatchObject({ success: true })
    expect((await detect({ directory: tmp.path })).project[`mcp:${item.id}`]).toBeUndefined()
    expect(await Bun.file(path.join(tmp.path, ".kilo", "skills", "recoverable-workflow", "SKILL.md")).exists()).toBe(
      false,
    )
  })
})
