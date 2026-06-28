import { describe, it, expect, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { MarketplaceInstaller } from "../../src/services/marketplace/installer"
import { MarketplacePaths } from "../../src/services/marketplace/paths"
import type { AgentMarketplaceItem } from "../../src/services/marketplace/types"
import { exec } from "../../src/util/process"
import * as yaml from "yaml"

const tmpDir = path.join(os.tmpdir(), `kilo-test-${Date.now()}`)

class TestPaths extends MarketplacePaths {
  override configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "global") return path.join(tmpDir, "global", "kilo.json")
    return path.join(tmpDir, "project", ".kilo", "kilo.json")
  }
  override skillsDir(scope: "project" | "global", workspace?: string): string {
    return path.join(tmpDir, "skills")
  }
}

function skill(content: string, id = "test-skill") {
  return {
    type: "skill" as const,
    id,
    name: "Test Skill",
    description: "test",
    category: "test",
    githubUrl: "https://example.com",
    content,
    displayName: "Test Skill",
    displayCategory: "Test",
  }
}

function agent(content: AgentMarketplaceItem["content"], id = "test-agent"): AgentMarketplaceItem {
  return {
    type: "agent",
    id,
    name: "Test Agent",
    description: "test",
    category: "development",
    content,
  }
}

async function frontmatter(file: string) {
  const content = await fs.readFile(file, "utf-8")
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  expect(match).not.toBeNull()
  return yaml.parse(match?.[1] ?? "") as Record<string, unknown>
}

async function archive(): Promise<Buffer> {
  const root = path.join(tmpDir, "archive")
  const source = path.join(root, "source")
  const dir = path.join(source, "skill")
  const tarball = path.join(root, "skill.tar.gz")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "SKILL.md"), "# Test Skill\n")
  await exec("tar", ["-czf", tarball, "-C", source, "skill"])
  return fs.readFile(tarball)
}

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("MarketplaceInstaller MCP format normalization", () => {
  it("converts local command+args+env format to CLI format", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "memory",
      name: "Memory",
      description: "test",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        env: { MY_KEY: "my-value" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.memory
    expect(mcp.type).toBe("local")
    expect(mcp.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-memory"])
    expect(mcp.environment).toEqual({ MY_KEY: "my-value" })
    expect(mcp.args).toBeUndefined()
    expect(mcp.env).toBeUndefined()
  })

  it("converts sse type to remote type", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "myremote",
      name: "Remote",
      description: "test",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({
        type: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer token" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.myremote
    expect(mcp.type).toBe("remote")
    expect(mcp.url).toBe("https://example.com/sse")
    expect(mcp.headers).toEqual({ Authorization: "Bearer token" })
  })

  it("keeps already-normalized local format unchanged", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "already",
      name: "Already Done",
      description: "test",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({
        type: "local",
        command: ["npx", "-y", "someserver"],
        environment: { KEY: "val" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.already
    expect(mcp).toEqual({ type: "local", command: ["npx", "-y", "someserver"], environment: { KEY: "val" } })
  })
})

describe("MarketplaceInstaller skills", () => {
  it("rejects project installs without a workspace directory", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const result = await installer.installSkill(skill("https://example.com/skill.tar.gz"), "project")

    expect(result).toEqual({
      success: false,
      slug: "test-skill",
      error: "No workspace directory for project-scope install",
    })
  })

  it("rejects project removals without a workspace directory", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const result = await installer.removeSkill(skill("https://example.com/skill.tar.gz"), "project")

    expect(result).toEqual({
      success: false,
      slug: "test-skill",
      error: "No workspace directory for project-scope removal",
    })
  })

  it("rejects project MCP and agent removals without a workspace directory", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const results = await Promise.all([
      installer.remove(
        {
          type: "mcp",
          id: "test-mcp",
          name: "Test MCP",
          description: "test",
          category: "development",
          url: "https://example.com",
          content: "{}",
        },
        "project",
      ),
      installer.remove(
        {
          type: "agent",
          id: "test-agent",
          name: "Test Agent",
          description: "test",
          category: "development",
          content: { mode: "all", description: "test", prompt: "test" },
        },
        "project",
      ),
    ])

    expect(results).toEqual([
      { success: false, slug: "test-mcp", error: "No workspace directory for project-scope removal" },
      { success: false, slug: "test-agent", error: "No workspace directory for project-scope removal" },
    ])
  })

  it("rejects skill ids that are unsafe on supported filesystems", async () => {
    const paths = new TestPaths()
    const dir = path.join(paths.skillsDir("project", tmpDir), "installed")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Installed\n")
    const installer = new MarketplaceInstaller(paths)

    for (const id of [".", "installed.", "CON", "nul.txt"]) {
      const result = await installer.removeSkill(skill("https://example.com/skill.tar.gz", id), "project", tmpDir)
      expect(result).toEqual({ success: false, slug: id, error: "Invalid skill id" })
    }

    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")).toBe("# Installed\n")
  })

  it("installs an extracted project skill without leaving staging directories", async () => {
    const buffer = await archive()
    const url = `data:application/gzip;base64,${buffer.toString("base64")}`
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const result = await installer.installSkill(skill(url), "project", tmpDir)

    expect(result.success).toBe(true)
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf-8")).toBe(
      "# Test Skill\n",
    )
    expect(
      (await fs.readdir(paths.skillsDir("project", tmpDir))).filter((name) => name.startsWith(".staging-")),
    ).toEqual([])
  })

  it("handles concurrent installs without sharing temporary paths", async () => {
    const buffer = await archive()
    const original = globalThis.fetch
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const item = skill("https://example.com/skill.tar.gz")
    const gate = Promise.withResolvers<void>()
    let count = 0
    globalThis.fetch = async () => {
      count += 1
      if (count === 2) gate.resolve()
      await gate.promise
      return new Response(buffer)
    }

    try {
      const results = await Promise.all([
        installer.installSkill(item, "project", tmpDir),
        installer.installSkill(item, "project", tmpDir),
      ])
      expect(count).toBe(2)
      expect(results.filter((result) => result.success)).toHaveLength(1)
      expect(results.find((result) => !result.success)?.error).toBe(
        "Skill already installed. Uninstall it before installing again.",
      )
      expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf-8")).toBe(
        "# Test Skill\n",
      )
      expect(
        (await fs.readdir(paths.skillsDir("project", tmpDir))).filter((name) => name.startsWith(".staging-")),
      ).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })
})

describe("MarketplaceInstaller agents", () => {
  it("preserves requirements in installed agent frontmatter", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = agent({
      mode: "all",
      description: "Requires local setup",
      prompt: "Use the available project tools.",
      requirements: {
        skills: ["project-skill"],
        mcps: ["project-mcp"],
        vscode_extensions: [{ name: "Project Helper", id: "publisher.project-helper" }],
      },
    })

    const result = await installer.installAgent(item, "project", tmpDir)

    expect(result.success).toBe(true)
    expect(result.filePath).toBeDefined()
    if (!result.filePath) throw new Error("agent install did not return a file path")
    const data = await frontmatter(result.filePath)
    expect(data.requirements).toEqual(item.content.requirements)
  })
})
