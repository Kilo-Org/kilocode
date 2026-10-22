import { describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloMarketplaceRegistry } from "../src/marketplace/kilo"
import { SkillError, bounded, extract, fingerprint, install, remove } from "../src/marketplace/skill"

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
  test("cancels bounded streams as soon as their byte budget is exceeded", async () => {
    let canceled = false
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(3))
      },
      cancel() {
        canceled = true
      },
    })
    await expect(bounded(stream, 4)).rejects.toThrow(/byte limit/)
    expect(canceled).toBe(true)
    expect(pulls).toBeLessThanOrEqual(3)
  })
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

  test("limits archive entries and expanded bytes before writing files", async () => {
    await expect(
      extract(
        await tarball({
          "SKILL.md": "demo",
          ...Object.fromEntries(Array.from({ length: 4096 }, (_, index) => [`files/${index}`, "x"])),
        }),
      ),
    ).rejects.toThrow(/too many entries/)
    await expect(extract(await tarball({ "SKILL.md": "demo", large: "x".repeat(33 * 1024 * 1024) }))).rejects.toThrow(
      /byte limit/,
    )
    await expect(extract(await tarball({ "SKILL.md": "x".repeat(65 * 1024 * 1024) }))).rejects.toThrow(/byte limit/)
  })
})

describe("skill install", () => {
  test("retries partially deleted owned trash after a project move without rehashing it", async () => {
    const directory = await tmp()
    const root = path.join(directory, "original", "skills")
    const target = await install({
      root,
      id: "demo",
      archive: await tarball({ "SKILL.md": "owned", "ref/a.txt": "keep until deleted" }),
      replace: false,
    })
    const owned = (await fingerprint(target))!
    const original = fs.rm
    const interrupted = Object.assign(new Error("recursive deletion interrupted"), { code: "EACCES" })
    const failure = spyOn(fs, "rm").mockImplementation(async (location, options) => {
      if (
        String(location).includes(".marketplace-trash") &&
        (await Bun.file(path.join(String(location), "SKILL.md")).exists())
      ) {
        await original(path.join(String(location), "SKILL.md"))
        throw interrupted
      }
      await original(location, options)
    })
    try {
      await expect(remove(target, [owned])).rejects.toBe(interrupted)
    } finally {
      failure.mockRestore()
    }
    expect(await fingerprint(target)).toBeUndefined()
    const trash = path.join(directory, "original", ".marketplace-trash")
    expect(await fs.readdir(trash)).toHaveLength(1)
    const abandoned = path.join(trash, (await fs.readdir(trash))[0])
    expect(await fingerprint(abandoned)).not.toBe(owned)
    expect(await Bun.file(path.join(abandoned, "ref/a.txt")).text()).toBe("keep until deleted")
    await fs.rename(path.join(directory, "original"), path.join(directory, "moved"))
    await remove(path.join(directory, "moved", "skills", "demo"), [owned])
    expect(await fs.readdir(path.join(directory, "moved"))).toEqual(["skills"])
  })

  test("replacement retries cleanup of interrupted old contents before installing the new tree", async () => {
    const directory = await tmp()
    const root = path.join(directory, "skills")
    const target = await install({
      root,
      id: "demo",
      archive: await tarball({ "SKILL.md": "old", "ref/a.txt": "old reference" }),
      replace: false,
    })
    const owned = (await fingerprint(target))!
    const archive = await tarball({ "SKILL.md": "new" })
    const original = fs.rm
    const interrupted = Object.assign(new Error("recursive deletion interrupted"), { code: "EACCES" })
    const failure = spyOn(fs, "rm").mockImplementation(async (location, options) => {
      if (
        String(location).includes(".marketplace-trash") &&
        (await Bun.file(path.join(String(location), "SKILL.md")).exists())
      ) {
        await original(path.join(String(location), "SKILL.md"))
        throw interrupted
      }
      await original(location, options)
    })
    try {
      await expect(install({ root, id: "demo", archive, replace: true, fingerprints: [owned] })).rejects.toBe(
        interrupted,
      )
    } finally {
      failure.mockRestore()
    }
    expect(await fingerprint(target)).toBeUndefined()
    expect((await fs.readdir(directory)).toSorted()).toEqual([".marketplace-trash", "skills"])
    await install({ root, id: "demo", archive, replace: true, fingerprints: [owned] })
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toBe("new")
    expect(await fs.readdir(directory)).toEqual(["skills"])
    await remove(target, [(await fingerprint(target))!])
  })

  test("fingerprints protect changed contents, added files, empty directories, and symbolic links", async () => {
    const root = path.join(await tmp(), "skills")
    const archive = await tarball({ "SKILL.md": "original", "ref/a.txt": "reference" })
    const target = await install({ root, id: "demo", archive, replace: false })
    const owned = (await fingerprint(target))!
    await expect(remove(target)).rejects.toMatchObject({ reason: "conflict" })
    await expect(install({ root, id: "demo", archive, replace: true })).rejects.toMatchObject({ reason: "conflict" })
    await Bun.write(path.join(target, "SKILL.md"), "edited")
    await expect(remove(target, [owned])).rejects.toMatchObject({ reason: "conflict" })
    await expect(install({ root, id: "demo", archive, replace: true, fingerprints: [owned] })).rejects.toMatchObject({
      reason: "conflict",
    })
    await Bun.write(path.join(target, "SKILL.md"), "original")
    expect(await fingerprint(target)).toBe(owned)
    await Bun.write(path.join(target, "user.txt"), "keep")
    await expect(remove(target, [owned])).rejects.toMatchObject({ reason: "conflict" })
    await fs.rm(path.join(target, "user.txt"))
    await fs.mkdir(path.join(target, "empty"))
    await expect(remove(target, [owned])).rejects.toMatchObject({ reason: "conflict" })
    await fs.rmdir(path.join(target, "empty"))
    await fs.symlink(path.join(target, "SKILL.md"), path.join(target, "link"))
    await expect(remove(target, [owned])).rejects.toMatchObject({ reason: "conflict" })
    await fs.rm(path.join(target, "link"))
    await remove(target, [owned])
  })

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

    await install({
      root,
      id: "demo",
      archive: await tarball({ "SKILL.md": "v2" }),
      replace: true,
      fingerprints: [(await fingerprint(target))!],
    })
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toBe("v2")

    await remove(target, [(await fingerprint(target))!])
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

  test("cleans staging after all writes settle when an archive has conflicting file and directory paths", async () => {
    const directory = await tmp()
    const root = path.join(directory, "skills")
    const archive = await tarball({
      "SKILL.md": "demo",
      conflict: "file",
      "conflict/child.txt": "child",
      ...Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`resources/${index}/data.txt`, "resource"])),
    })
    await expect(install({ root, id: "demo", archive, replace: false })).rejects.toBeDefined()
    expect(await fs.readdir(directory)).toEqual([])
  })

  test("cleans staging when the skills root is not a directory", async () => {
    const directory = await tmp()
    // A file cannot be used as the skills root; failure occurs after staging is written.
    const blocked = path.join(directory, "blocked")
    await Bun.write(blocked, "not a directory")
    await expect(
      install({ root: blocked, id: "demo", archive: await tarball({ "SKILL.md": "new" }), replace: true }),
    ).rejects.toBeDefined()
    expect(await fs.readdir(directory)).toEqual(["blocked"])
    expect(await Bun.file(blocked).text()).toBe("not a directory")
  })
})
