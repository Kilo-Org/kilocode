import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { ClaudeMigration } from "@/kilocode/config/claude-migration"
import { tmpdir } from "../../fixture/fixture"

async function sourceTree(root: string) {
  const result: Record<string, unknown> = {}
  const visit = async (relative: string): Promise<void> => {
    const file = path.join(root, relative)
    const info = await fs.lstat(file)
    result[relative] = {
      bytes: info.isFile() ? await fs.readFile(file) : undefined,
      ino: info.ino,
      mode: info.mode & 0o7777,
      mtimeMs: info.mtimeMs,
      size: info.size,
      type: info.isDirectory() ? "directory" : info.isSymbolicLink() ? "symlink" : "file",
    }
    if (!info.isDirectory()) return
    for (const entry of (await fs.readdir(file)).sort()) await visit(path.join(relative, entry))
  }

  for (const relative of [".claude", ".claude.json"]) {
    try {
      await visit(relative)
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue
      throw error
    }
  }
  return result
}

async function allPaths(root: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (relative: string): Promise<void> => {
    const file = path.join(root, relative)
    const info = await fs.lstat(file)
    result.push(relative)
    if (!info.isDirectory()) return
    for (const entry of await fs.readdir(file)) await visit(path.join(relative, entry))
  }
  try {
    await visit(".")
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error
  }
  return result
}

describe("Claude global configuration migration", () => {
  test("imports the supported subset without touching Claude files", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const config = path.join(tmp.path, "config")
    const state = path.join(tmp.path, "state")
    await fs.mkdir(path.join(home, ".claude", "skills", "audit"), { recursive: true })
    await fs.mkdir(config, { recursive: true })
    const source = {
      rules: "Use the repository's existing test conventions.\nUse @acme/ui components.\n// {env:EXAMPLE}\n",
      skill: "Review the changed files and report only actionable findings.\n",
      mcp: JSON.stringify({
        mcpServers: {
          local: { command: "npx", args: ["-y", "example-mcp"], env: { TOKEN: "secret-token" } },
          remote: { type: "http", url: "https://example.test/mcp", headers: { Authorization: "Bearer secret-token" } },
        },
        projects: { [tmp.path]: { mcpServers: { projectOnly: { command: "ignored" } } } },
      }),
    }
    await fs.writeFile(path.join(home, ".claude", "CLAUDE.md"), source.rules)
    await fs.writeFile(path.join(home, ".claude", "skills", "audit", "SKILL.md"), source.skill)
    await fs.writeFile(path.join(home, ".claude.json"), source.mcp)
    const before = await sourceTree(home)

    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = config
    try {
      const result = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
      expect(result.status).toBe("complete")
      if (result.status !== "complete") return
      expect(result.receipt.items.filter((item) => item.status === "imported")).toHaveLength(4)
      expect(await fs.readFile(path.join(config, "AGENTS.md"), "utf8")).toBe(source.rules)
      expect(await fs.readFile(path.join(config, "skills", "audit", "SKILL.md"), "utf8")).toContain('name: "audit"')

      const native = JSON.parse(await fs.readFile(path.join(config, "kilo.jsonc"), "utf8"))
      expect(native.mcp.local).toEqual({
        type: "local",
        command: ["npx", "-y", "example-mcp"],
        environment: { TOKEN: "secret-token" },
        enabled: false,
      })
      expect(native.mcp.remote).toEqual({
        type: "remote",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer secret-token" },
        enabled: false,
        oauth: false,
      })
      expect(native.mcp.projectOnly).toBeUndefined()
      expect(JSON.stringify(result.receipt)).not.toContain("secret-token")
      expect(await sourceTree(home)).toEqual(before)
      expect((await allPaths(tmp.path)).filter((item) => item.includes(".tmp")).length).toBe(0)
      expect(ClaudeMigration.globalHandoff({ state })).toBe(true)
      expect((await ClaudeMigration.notification({ state }))?.id).toBe(ClaudeMigration.NOTIFICATION_ID)
    } finally {
      ;(Global.Path as { config: string }).config = previous
    }
  })

  test("preserves existing Kilo files and never retries after completion", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const config = path.join(tmp.path, "config")
    const state = path.join(tmp.path, "state")
    await fs.mkdir(path.join(home, ".claude", "skills", "unsafe"), { recursive: true })
    await fs.mkdir(config, { recursive: true })
    await fs.writeFile(path.join(home, ".claude", "CLAUDE.md"), "source rules")
    await fs.writeFile(path.join(home, ".claude", "skills", "unsafe", "SKILL.md"), "---\ncontext: fork\n---\nunsafe")
    await fs.writeFile(path.join(home, ".claude", "skills", "unsafe", "helper.txt"), "dependency")
    await fs.writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          existing: { command: "ignored" },
          imported: { command: "npx", args: ["example-mcp"] },
        },
      }),
    )
    await fs.writeFile(path.join(config, "AGENTS.md"), "existing rules")
    await fs.writeFile(
      path.join(config, "kilo.jsonc"),
      JSON.stringify({ mcp: { existing: { type: "local", command: ["keep"] } } }),
    )

    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = config
    try {
      const first = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
      expect(first.status).toBe("complete")
      if (first.status !== "complete") return
      expect(first.receipt.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: "instructions", reason: "destination-exists", status: "skipped" }),
          expect.objectContaining({
            category: "skill",
            name: "unsafe",
            reason: "skill-bundle-unsupported",
            status: "skipped",
          }),
          expect.objectContaining({
            category: "mcp",
            name: "existing",
            reason: "mcp-name-conflict",
            status: "skipped",
          }),
          expect.objectContaining({ category: "mcp", name: "imported", status: "imported" }),
        ]),
      )
      const native = JSON.parse(await fs.readFile(path.join(config, "kilo.jsonc"), "utf8"))
      expect(native.mcp.imported).toEqual({
        type: "local",
        command: ["npx", "example-mcp"],
        enabled: false,
      })
      const notice = await ClaudeMigration.notification({ state })
      expect(notice?.message).toContain(
        "Global CLAUDE.md: Kilo already has AGENTS.md; existing instructions were kept.",
      )
      expect(notice?.message).toContain('Skill "unsafe": it contains additional files')
      expect(notice?.message).toContain('MCP server "existing": Kilo already has an MCP server with that name')
      expect(notice?.message).toContain("merge skipped instructions or skills manually")
      expect(notice?.message).toContain("this migration runs once.\nOriginal Claude files")
      await fs.writeFile(path.join(home, ".claude", "CLAUDE.md"), "changed source")
      await fs.mkdir(path.join(home, ".claude", "skills", "new"))
      await fs.writeFile(path.join(home, ".claude", "skills", "new", "SKILL.md"), "new skill")
      const second = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
      expect(second.status).toBe("already-attempted")
      expect(await fs.readFile(path.join(config, "AGENTS.md"), "utf8")).toBe("existing rules")
      expect(await fs.readFile(path.join(config, "kilo.jsonc"), "utf8")).not.toContain('"new"')
    } finally {
      ;(Global.Path as { config: string }).config = previous
    }
  })

  test("imports minimal skill metadata and rejects dynamic or bundled skills", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const config = path.join(tmp.path, "config")
    const state = path.join(tmp.path, "state")
    await fs.mkdir(path.join(home, ".claude", "skills", "metadata"), { recursive: true })
    await fs.mkdir(path.join(home, ".claude", "skills", "dynamic"), { recursive: true })
    await fs.mkdir(path.join(home, ".claude", "skills", "bundle"), { recursive: true })
    await fs.mkdir(path.join(home, ".claude", "skills", "file-reference"), { recursive: true })
    await fs.mkdir(path.join(home, ".claude", "skills", "shell"), { recursive: true })
    await fs.mkdir(path.join(home, ".claude", "skills", "shell-docs"), { recursive: true })
    await fs.mkdir(config, { recursive: true })
    await fs.writeFile(
      path.join(home, ".claude", "skills", "metadata", "SKILL.md"),
      "---\ndescription: Review: changed files\nlicense: MIT\ncompatibility: node\nmetadata:\n  owner: team\n---\nUse @acme/ui components.\n// {env:EXAMPLE}\n",
    )
    await fs.writeFile(path.join(home, ".claude", "skills", "dynamic", "SKILL.md"), "Use $ARGUMENTS[0].\n")
    await fs.writeFile(path.join(home, ".claude", "skills", "bundle", "SKILL.md"), "Body\n")
    await fs.writeFile(path.join(home, ".claude", "skills", "bundle", "helper.txt"), "Helper\n")
    await fs.writeFile(
      path.join(home, ".claude", "skills", "file-reference", "SKILL.md"),
      "Use @./guide.md and @src/index.ts.\n",
    )
    await fs.writeFile(path.join(home, ".claude", "skills", "shell", "SKILL.md"), "Run !`printf hi`.\n")
    await fs.writeFile(path.join(home, ".claude", "skills", "shell-docs", "SKILL.md"), "```sh\n!`printf hi`\n```\n")

    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = config
    try {
      const result = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
      expect(result.status).toBe("complete")
      if (result.status !== "complete") return
      expect(await fs.readFile(path.join(config, "skills", "metadata", "SKILL.md"), "utf8")).toBe(
        '---\nname: "metadata"\ndescription: "Review: changed files"\nlicense: "MIT"\ncompatibility: "node"\nmetadata: {"owner":"team"}\n---\nUse @acme/ui components.\n// {env:EXAMPLE}\n',
      )
      expect(await fs.readFile(path.join(config, "skills", "shell-docs", "SKILL.md"), "utf8")).toBe(
        '---\nname: "shell-docs"\n---\n```sh\n!`printf hi`\n```\n',
      )
      expect(result.receipt.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "dynamic", reason: "unsupported-markdown", status: "skipped" }),
          expect.objectContaining({ name: "bundle", reason: "skill-bundle-unsupported", status: "skipped" }),
          expect.objectContaining({ name: "file-reference", reason: "unsupported-markdown", status: "skipped" }),
          expect.objectContaining({ name: "shell", reason: "unsupported-markdown", status: "skipped" }),
        ]),
      )
    } finally {
      ;(Global.Path as { config: string }).config = previous
    }
  })

  test("does not create a receipt when there is no source", async () => {
    await using tmp = await tmpdir()
    const roots = {
      home: path.join(tmp.path, "home"),
      config: path.join(tmp.path, "config"),
      state: path.join(tmp.path, "state"),
    }
    const result = await ClaudeMigration.run({ enabled: true, roots })
    expect(result).toEqual({ status: "no-source" })
    expect(ClaudeMigration.hasAttempt(roots)).toBe(false)
  })

  test("does not claim an attempt when disabled or custom-routed", async () => {
    const keys = ["CLAUDE_CONFIG_DIR", "KILO_CONFIG_DIR", "KILO_CONFIG", "KILO_CONFIG_CONTENT"]
    await using tmp = await tmpdir()
    const roots = {
      home: path.join(tmp.path, "home"),
      config: path.join(tmp.path, "config"),
      state: path.join(tmp.path, "state"),
    }
    await fs.mkdir(path.join(roots.home, ".claude"), { recursive: true })
    await fs.writeFile(path.join(roots.home, ".claude", "CLAUDE.md"), "source")

    expect(await ClaudeMigration.run({ enabled: false, roots })).toEqual({ status: "disabled" })
    expect(ClaudeMigration.hasAttempt(roots)).toBe(false)

    for (const key of keys) {
      const previous = process.env[key]
      process.env[key] = path.join(tmp.path, key.toLowerCase())
      try {
        expect(await ClaudeMigration.run({ enabled: true, roots })).toEqual({ status: "unsupported-context" })
        expect(ClaudeMigration.hasAttempt(roots)).toBe(false)
      } finally {
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
      }
    }
  })

  test("blocks retries for malformed and unfinished receipts", async () => {
    const check = async (value: string, expected: ClaudeMigration.Receipt["status"] | undefined) => {
      await using tmp = await tmpdir()
      const home = path.join(tmp.path, "home")
      const config = path.join(tmp.path, "config")
      const state = path.join(tmp.path, "state")
      await fs.mkdir(path.join(home, ".claude"), { recursive: true })
      await fs.mkdir(state, { recursive: true })
      await fs.writeFile(path.join(home, ".claude", "CLAUDE.md"), "source")
      await fs.writeFile(path.join(state, ClaudeMigration.RECEIPT), value)

      const result = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
      expect(result.status).toBe("already-attempted")
      if (result.status !== "already-attempted") return
      expect(result.receipt?.status).toBe(expected)
      expect(await fs.stat(path.join(state, ClaudeMigration.RECEIPT))).toBeTruthy()
      expect(await Bun.file(path.join(config, "AGENTS.md")).exists()).toBe(false)
    }

    await check("{invalid", undefined)
    await check(JSON.stringify({ version: 99, status: "complete", startedAt: "now", items: [] }), undefined)
    await check(JSON.stringify({ version: 1, status: "started", startedAt: "now", items: [] }), "started")
    await check(JSON.stringify({ version: 1, status: "incomplete", startedAt: "now", items: [] }), "incomplete")
  })

  test("rejects dynamic and unsupported MCP entries without writing them", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const config = path.join(tmp.path, "config")
    const state = path.join(tmp.path, "state")
    await fs.mkdir(path.join(home, ".claude"), { recursive: true })
    await fs.writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          relative: { command: "./run" },
          interpolation: { command: "npx", args: ["${TOKEN}"] },
          headerInterpolation: {
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: "{env:TOKEN}" },
          },
          unsupported: { command: "npx", extra: "value" },
          invalidRemote: { type: "http", url: "ftp://example.test/mcp" },
        },
      }),
    )

    const result = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
    expect(result.status).toBe("complete")
    if (result.status !== "complete") return
    expect(result.receipt.items.filter((item) => item.status === "imported")).toHaveLength(0)
    expect(result.receipt.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "relative", reason: "mcp-relative-path-unsupported" }),
        expect.objectContaining({ name: "interpolation", reason: "mcp-interpolation-unsupported" }),
        expect.objectContaining({ name: "headerInterpolation", reason: "mcp-interpolation-unsupported" }),
        expect.objectContaining({ name: "unsupported", reason: "mcp-field-unsupported" }),
        expect.objectContaining({ name: "invalidRemote", reason: "mcp-url-invalid" }),
      ]),
    )
    expect(await Bun.file(path.join(config, "kilo.jsonc")).exists()).toBe(false)
  })

  test("does not follow source symlinks", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const config = path.join(tmp.path, "config")
    const state = path.join(tmp.path, "state")
    const outside = path.join(tmp.path, "outside")
    await fs.mkdir(path.join(home, ".claude", "skills"), { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, "SKILL.md"), "secret source")
    await fs.symlink(outside, path.join(home, ".claude", "skills", "linked"), "dir")
    const before = await sourceTree(home)

    const result = await ClaudeMigration.run({ enabled: true, roots: { home, config, state } })
    expect(result.status).toBe("complete")
    if (result.status !== "complete") return
    expect(result.receipt.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linked", reason: "unsafe-skill-name", status: "skipped" }),
      ]),
    )
    expect(await sourceTree(home)).toEqual(before)
    expect(await Bun.file(path.join(config, "skills", "linked", "SKILL.md")).exists()).toBe(false)
  })

  test("only one concurrent caller claims the receipt", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const config = path.join(tmp.path, "config")
    const state = path.join(tmp.path, "state")
    await fs.mkdir(path.join(home, ".claude"), { recursive: true })
    await fs.writeFile(path.join(home, ".claude", "CLAUDE.md"), "source")

    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = config
    try {
      const results = await Promise.all([
        ClaudeMigration.run({ enabled: true, roots: { home, config, state } }),
        ClaudeMigration.run({ enabled: true, roots: { home, config, state } }),
      ])
      expect(results.filter((result) => result.status === "complete")).toHaveLength(1)
      expect(results.filter((result) => result.status === "already-attempted")).toHaveLength(1)
      expect((await ClaudeMigration.readReceipt({ state }))?.status).toBe("complete")
      expect(await fs.readFile(path.join(config, "AGENTS.md"), "utf8")).toBe("source")
      expect((await allPaths(tmp.path)).filter((item) => item.includes(".tmp"))).toEqual([])
    } finally {
      ;(Global.Path as { config: string }).config = previous
    }
  })
})
