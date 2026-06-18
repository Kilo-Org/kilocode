import { afterEach, describe, expect, it } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import * as Catalog from "@/kilocode/marketplace/catalog"
import { detect } from "@/kilocode/marketplace/detection"
import * as Installer from "@/kilocode/marketplace/installer"
import { Marketplace } from "@/kilocode/marketplace"
import { InstallResult, type McpItem, type SkillItem } from "@/kilocode/marketplace/types"
import { Skill } from "@/skill"
import { Process } from "@/util/process"
import { Effect, Layer, Schema } from "effect"
import { tmpdir } from "../../fixture/fixture"

const original = Global.Path.config
const fetch = globalThis.fetch
const cfg = Layer.mock(Config.Service)({})

function setFetch(fn: () => Promise<Response> | Response) {
  globalThis.fetch = Object.assign(async () => fn(), { preconnect: fetch.preconnect }) as typeof fetch
}

afterEach(() => {
  Global.Path.config = original
  globalThis.fetch = fetch
  Catalog.clear()
})

function mcp(item: Partial<McpItem>): McpItem {
  return {
    id: "memory",
    type: "mcp",
    name: "Memory",
    description: "",
    url: "https://example.com/memory",
    content: JSON.stringify({ command: "memory" }),
    ...item,
  }
}

function skill(item: Partial<SkillItem>): SkillItem {
  return {
    id: "starter",
    type: "skill",
    name: "Starter",
    description: "",
    category: "general",
    githubUrl: "https://example.com/starter",
    content: "https://example.com/starter.tgz",
    displayName: "Starter",
    displayCategory: "General",
    ...item,
  }
}

function layer(current: Config.Info, updates: Config.Info[]) {
  return Layer.mock(Config.Service)({
    get: () => Effect.succeed(current),
    update: (config) => {
      updates.push(config)
      return Effect.void
    },
  })
}

async function tar(root: string, name: string) {
  const archive = `${name}.tar.gz`
  const file = path.join(root, archive)
  await Process.run(["tar", "-czf", archive, name], { cwd: root })
  return await Bun.file(file).arrayBuffer()
}

describe("Kilo marketplace reusable state", () => {
  it("detects skills from reusable CLI roots only", async () => {
    await using tmp = await tmpdir()
    await using global = await tmpdir()
    Global.Path.config = global.path

    const ctx = { directory: tmp.path, worktree: tmp.path }
    const project = path.join(tmp.path, ".kilo", "skills", "project", "SKILL.md")
    const shared = path.join(global.path, "skills", "global", "SKILL.md")
    const vscode = path.join(
      tmp.path,
      "Code",
      "User",
      "globalStorage",
      "kilocode.kilo-code",
      "skills",
      "legacy",
      "SKILL.md",
    )
    const layer = Layer.mergeAll(
      Layer.mock(Config.Service)({
        get: () => Effect.succeed({}),
        getGlobal: () => Effect.succeed({}),
      }),
      Layer.mock(Skill.Service)({
        all: () =>
          Effect.succeed([
            { name: "project", location: project, content: "" },
            { name: "global", location: shared, content: "" },
            { name: "legacy", location: vscode, content: "" },
          ]),
        dirs: () => Effect.succeed([path.dirname(project), path.dirname(shared), path.dirname(vscode)]),
      }),
    )

    const out = await Effect.runPromise(detect(ctx).pipe(Effect.provide(layer)))

    expect(out.project.project).toEqual({ type: "skill" })
    expect(out.global.global).toEqual({ type: "skill" })
    expect(out.global.legacy).toBeUndefined()
    expect(out.project.legacy).toBeUndefined()
  })

  it("rejects duplicate agents from every reusable agent root", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilo", "agents")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, "helper.md"), "---\ndescription: helper\n---\n")

    const out = await Effect.runPromise(
      Installer.install(
        {
          id: "helper",
          type: "agent",
          name: "Helper",
          description: "",
          content: { mode: "primary", description: "", prompt: "" },
        },
        { id: "helper", type: "agent", target: "project" },
        { directory: tmp.path, worktree: tmp.path },
      ).pipe(Effect.provide(cfg)),
    )

    expect(out).toEqual({ success: false, slug: "helper", error: "Agent already installed. Remove it first." })
  })

  it("rejects duplicate skills from reusable CLI skill roots", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilocode", "skills", "starter")
    await fs.mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, "SKILL.md"), "---\nname: starter\n---\n")

    const out = await Effect.runPromise(
      Installer.install(
        {
          id: "starter",
          type: "skill",
          name: "Starter",
          description: "",
          category: "general",
          githubUrl: "https://example.com/starter",
          content: "https://example.com/starter.tgz",
          displayName: "Starter",
          displayCategory: "General",
        },
        { id: "starter", type: "skill", target: "project" },
        { directory: tmp.path, worktree: tmp.path },
      ).pipe(Effect.provide(cfg)),
    )

    expect(out).toEqual({
      success: false,
      slug: "starter",
      error: "Skill already installed. Uninstall it before installing again.",
    })
  })

  it("normalizes legacy MCP local and remote configs", async () => {
    const updates: Config.Info[] = []
    const local = await Effect.runPromise(
      Installer.install(
        mcp({ id: "local", content: JSON.stringify({ command: "npx", args: ["server"], env: { KEY: "value" } }) }),
        { id: "local", type: "mcp", target: "project" },
        { directory: "/repo", worktree: "/repo" },
      ).pipe(Effect.provide(layer({}, updates))),
    )
    const remote = await Effect.runPromise(
      Installer.install(
        mcp({ id: "remote", content: JSON.stringify({ type: "sse", url: "https://mcp.example", headers: { A: "B" } }) }),
        { id: "remote", type: "mcp", target: "project" },
        { directory: "/repo", worktree: "/repo" },
      ).pipe(Effect.provide(layer({}, updates))),
    )

    expect(local).toEqual({ success: true, slug: "local" })
    expect(remote).toEqual({ success: true, slug: "remote" })
    expect(updates[0].mcp?.local).toEqual({ type: "local", command: ["npx", "server"], environment: { KEY: "value" } })
    expect(updates[1].mcp?.remote).toEqual({ type: "remote", url: "https://mcp.example", headers: { A: "B" } })
  })

  it("selects MCP methods and substitutes escaped parameters", async () => {
    const updates: Config.Info[] = []
    const out = await Effect.runPromise(
      Installer.install(
        mcp({
          content: [
            { name: "stdio", content: JSON.stringify({ command: "first" }) },
            { name: "remote", content: '{"url":"https://example.com/${token}","headers":{"Auth":"{{secret}}"}}' },
          ],
        }),
        { id: "memory", type: "mcp", target: "project", parameters: { __method: "remote", token: "abc", secret: 'a"b' } },
        { directory: "/repo", worktree: "/repo" },
      ).pipe(Effect.provide(layer({}, updates))),
    )

    expect(out).toEqual({ success: true, slug: "memory" })
    expect(updates[0].mcp?.memory).toEqual({ type: "remote", url: "https://example.com/abc", headers: { Auth: 'a"b' } })
  })

  it("returns structured MCP install errors", async () => {
    const out = await Effect.runPromise(
      Installer.install(
        mcp({ content: "not json" }),
        { id: "memory", type: "mcp", target: "project" },
        { directory: "/repo", worktree: "/repo" },
      ).pipe(Effect.provide(layer({}, []))),
    )

    expect(out.success).toBe(false)
    expect(out.slug).toBe("memory")
    expect(out.error).toStartWith("Invalid MCP config:")
  })

  it("writes marketplace agents and removes stale config entries", async () => {
    await using tmp = await tmpdir()
    const updates: Config.Info[] = []

    const out = await Effect.runPromise(
      Installer.install(
        {
          id: "helper",
          type: "agent",
          name: "Helper",
          description: "",
          content: { mode: "subagent", description: "Helps", prompt: "Do work" },
        },
        { id: "helper", type: "agent", target: "project" },
        { directory: tmp.path, worktree: tmp.path },
      ).pipe(Effect.provide(layer({ agent: { helper: {} } }, updates))),
    )
    const file = path.join(tmp.path, ".kilo", "agent", "helper.md")

    const result = out as InstallResult
    expect(result.success).toBe(true)
    expect(result.slug).toBe("helper")
    expect(result.filePath).toBe(file)
    expect(result.line).toBe(1)
    expect(await Bun.file(file).text()).toContain("mode: \"subagent\"")
    expect((updates[0] as unknown as { agent: Record<string, unknown> }).agent.helper).toBeNull()
  })

  it("rejects unsafe agent and skill ids", async () => {
    await using tmp = await tmpdir()
    const agent = await Effect.runPromise(
      Installer.install(
        { id: "con", type: "agent", name: "Con", description: "", content: { mode: "primary", description: "", prompt: "x" } },
        { id: "con", type: "agent", target: "project" },
        { directory: tmp.path, worktree: tmp.path },
      ).pipe(Effect.provide(cfg)),
    )
    const bad = await Effect.runPromise(
      Installer.install(skill({ id: "starter." }), { id: "starter.", type: "skill", target: "project" }, { directory: tmp.path, worktree: tmp.path }).pipe(
        Effect.provide(cfg),
      ),
    )

    expect(agent).toEqual({ success: false, slug: "con", error: "Invalid agent id" })
    expect(bad).toEqual({ success: false, slug: "starter.", error: "Invalid skill id" })
  })

  it("rejects skill archives missing SKILL.md", async () => {
    await using tmp = await tmpdir()
    const pkg = path.join(tmp.path, "pkg")
    await fs.mkdir(pkg, { recursive: true })
    await Bun.write(path.join(pkg, "README.md"), "missing skill")
    const body = await tar(tmp.path, "pkg")
    setFetch(() => new Response(body))

    const out = await Effect.runPromise(
      Installer.install(skill({}), { id: "starter", type: "skill", target: "project" }, { directory: tmp.path, worktree: tmp.path }).pipe(
        Effect.provide(cfg),
      ),
    )

    expect(out).toEqual({ success: false, slug: "starter", error: "Extracted archive missing SKILL.md" })
  })

  it("rejects skill archives with escaped symlinks", async () => {
    await using tmp = await tmpdir()
    const pkg = path.join(tmp.path, "pkg")
    await fs.mkdir(pkg, { recursive: true })
    await Bun.write(path.join(pkg, "SKILL.md"), "# Skill")
    await fs.symlink(tmp.path, path.join(pkg, "outside"))
    const body = await tar(tmp.path, "pkg")
    setFetch(() => new Response(body))

    const out = await Effect.runPromise(
      Installer.install(skill({}), { id: "starter", type: "skill", target: "project" }, { directory: tmp.path, worktree: tmp.path }).pipe(
        Effect.provide(cfg),
      ),
    )

    expect(out).toEqual({ success: false, slug: "starter", error: "Skill archive contains unsafe paths" })
  })

  it("rejects skill archives with broken symlinks", async () => {
    await using tmp = await tmpdir()
    const pkg = path.join(tmp.path, "pkg")
    await fs.mkdir(pkg, { recursive: true })
    await Bun.write(path.join(pkg, "SKILL.md"), "# Skill")
    await fs.symlink(path.join(tmp.path, "missing"), path.join(pkg, "broken"))
    const body = await tar(tmp.path, "pkg")
    setFetch(() => new Response(body))

    const out = await Effect.runPromise(
      Installer.install(skill({}), { id: "starter", type: "skill", target: "project" }, { directory: tmp.path, worktree: tmp.path }).pipe(
        Effect.provide(cfg),
      ),
    )

    expect(out).toEqual({ success: false, slug: "starter", error: "Skill archive contains unsafe paths" })
  })

  it("uses install payload item when the catalog cannot resolve it", async () => {
    const updates: Config.Info[] = []
    setFetch(() => new Response(JSON.stringify({ items: [] })))

    const out = await Effect.runPromise(
      Marketplace.install(
        {
          id: "memory",
          type: "mcp",
          target: "project",
          item: mcp({ content: JSON.stringify({ command: "memory" }) }),
        },
        { directory: "/repo", worktree: "/repo" },
      ).pipe(Effect.provide(layer({}, updates))),
    )

    expect(out).toEqual({ success: true, slug: "memory" })
    expect(updates[0].mcp?.memory).toEqual({ type: "local", command: ["memory"] })
  })

  it("leaves VS Code legacy MCP files to the editor compatibility layer", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, ".kilo", "mcp.json")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, JSON.stringify({ mcpServers: { memory: {} } }))
    const layer = Layer.mock(Config.Service)({
      update: () => Effect.void,
    })

    const out = await Effect.runPromise(
      Installer.remove(
        { id: "memory", type: "mcp", name: "Memory", description: "", url: "", content: "" },
        "project",
        { directory: tmp.path, worktree: tmp.path },
      ).pipe(Effect.provide(layer)),
    )
    const parsed = JSON.parse(await Bun.file(file).text()) as { mcpServers: Record<string, unknown> }

    expect(out).toEqual({ success: true, slug: "memory" })
    expect(parsed.mcpServers.memory).toEqual({})
  })

  it("requires install result lines to be positive integers", () => {
    expect(Schema.decodeUnknownSync(InstallResult)({ success: true, slug: "item", line: 1 }).line).toBe(1)
    expect(() => Schema.decodeUnknownSync(InstallResult)({ success: true, slug: "item", line: 1.5 })).toThrow()
    expect(() => Schema.decodeUnknownSync(InstallResult)({ success: true, slug: "item", line: 0 })).toThrow()
  })
})
