import { afterEach, describe, expect, it } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { detect } from "@/kilocode/marketplace/detection"
import * as Installer from "@/kilocode/marketplace/installer"
import { InstallResult } from "@/kilocode/marketplace/types"
import { Skill } from "@/skill"
import { Effect, Layer, Schema } from "effect"
import { tmpdir } from "../../fixture/fixture"

const original = Global.Path.config
const cfg = Layer.mock(Config.Service)({})

afterEach(() => {
  Global.Path.config = original
})

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
