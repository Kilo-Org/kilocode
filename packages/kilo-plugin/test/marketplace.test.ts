import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloMarketplaceRegistry } from "../src/marketplace/kilo"
import { SkillError, extract, install, remove } from "../src/marketplace/skill"

const SKILLS = `
items:
  - id: demo-skill
    description: >-
      Does a demo.
    category: business
    githubUrl: https://github.com/Kilo-Org/kilo-marketplace/tree/main/skills/demo-skill
    content: https://example.com/demo-skill.tar.gz
  - description: no id, skipped
`

const MCPS = `
items:
  - id: context7
    name: Context7
    description: Docs
    author: upstash
    category: search
    tags: [search]
    content:
      - name: NPX
        prerequisites: [Node.js]
        content: |
          { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] }
        parameters:
          - name: Default Minimum Tokens
            key: DEFAULT_MINIMUM_TOKENS
            optional: true
      - name: Remote Server
        content: |
          { "type": "streamable-http", "url": "https://mcp.context7.com/mcp" }
  - id: composer-trade
    name: Composer
    description: Trading
    content: >
      { "command": "uvx", "args": ["composer-trade-mcp==0.1.4"] }
    parameters:
      - name: Composer API Key
        key: COMPOSER_API_KEY
`

const tarball = (files: Record<string, string>) => new Bun.Archive(files, { compress: "gzip" }).bytes()

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-"))

describe("Kilo marketplace registry", () => {
  test("normalizes skills and skips entries that do not decode", () => {
    const entries = KiloMarketplaceRegistry.parse("skill", SKILLS)
    expect(entries).toHaveLength(1)
    expect(entries[0].item).toMatchObject({
      registry: "kilo",
      kind: "skill",
      id: "demo-skill",
      name: "demo-skill",
      description: "Does a demo.",
      url: "https://github.com/Kilo-Org/kilo-marketplace/tree/main/skills/demo-skill",
    })
    expect(entries[0].archive).toBe("https://example.com/demo-skill.tar.gz")
  })

  test("normalizes MCP option lists and single config strings", () => {
    const [context7, composer] = KiloMarketplaceRegistry.parse("mcp", MCPS)
    expect(context7.item.options.map((option) => option.name)).toEqual(["NPX", "Remote Server"])
    expect(context7.item.options[0].parameters).toEqual([
      { key: "DEFAULT_MINIMUM_TOKENS", name: "Default Minimum Tokens", placeholder: undefined, optional: true },
    ])
    expect(context7.payloads).toHaveLength(2)
    expect(composer.item.options.map((option) => option.name)).toEqual(["Default"])
    expect(composer.item.parameters[0]).toMatchObject({ key: "COMPOSER_API_KEY", optional: false })
  })

  test("fetches the Kilo marketplace", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: (request) => new Response(new URL(request.url).pathname.endsWith("/skills") ? SKILLS : MCPS),
    })
    const registry = KiloMarketplaceRegistry.make({ server: server.url.origin })
    const [skills, mcps] = await Promise.all([registry.list("skill"), registry.list("mcp")])
    expect(skills).toHaveLength(1)
    expect(skills.every((entry) => entry.archive?.endsWith(".tar.gz"))).toBe(true)
    expect(mcps).toHaveLength(2)
    expect(mcps.every((entry) => entry.item.options.length > 0)).toBe(true)
  })
})

describe("skill archives", () => {
  test("strips the single top-level directory", async () => {
    const files = await extract(await tarball({ "demo/SKILL.md": "# demo", "demo/ref/a.md": "a" }))
    expect(files.map((file) => file.path).toSorted()).toEqual(["SKILL.md", "ref/a.md"])
  })

  test("accepts a skill at the archive root", async () => {
    const files = await extract(await tarball({ "SKILL.md": "# demo", "ref/a.md": "a" }))
    expect(files.map((file) => file.path).toSorted()).toEqual(["SKILL.md", "ref/a.md"])
  })

  test("rejects archives without SKILL.md", async () => {
    await await expect(extract(await tarball({ "demo/README.md": "x" }))).rejects.toBeInstanceOf(SkillError)
  })

  test("rejects path traversal", async () => {
    await await expect(extract(await tarball({ "demo/SKILL.md": "x", "demo/../../evil": "x" }))).rejects.toThrow(
      /unsafe path/,
    )
  })
})

describe("skill install", () => {
  test("installs, refuses to overwrite foreign directories, replaces its own, and removes", async () => {
    const root = path.join(await tmp(), "skills")
    const archive = await tarball({ "demo/SKILL.md": "---\nname: demo\n---\nv1" })
    const target = await install({ root, id: "demo", archive, replace: false })
    expect(target).toBe(path.join(root, "demo"))
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toContain("v1")
    expect(await fs.readdir(path.dirname(root))).toEqual(["skills"])

    await await expect(install({ root, id: "demo", archive, replace: false })).rejects.toMatchObject({
      reason: "conflict",
    })

    await install({ root, id: "demo", archive: await tarball({ "SKILL.md": "v2" }), replace: true })
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toBe("v2")

    await remove(target)
    expect(await fs.readdir(root)).toEqual([])
    await remove(target)
  })

  test("rejects ids that are not a single path segment", async () => {
    const root = path.join(await tmp(), "skills")
    await await expect(
      install({ root, id: "../x", archive: await tarball({ "SKILL.md": "x" }), replace: false }),
    ).rejects.toMatchObject({
      reason: "invalid",
    })
  })
})
