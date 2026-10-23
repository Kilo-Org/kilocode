import { describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloMarketplaceRegistry } from "../src/marketplace/kilo"
import { SkillError, bounded, extract, fingerprint, prepare, remove, write } from "../src/marketplace/skill"

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

// Mirrors Installer.install: replacing an existing tree is authorized only by an owned fingerprint.
const install = async (input: { root: string; id: string; archive: Uint8Array; fingerprints?: readonly string[] }) =>
  write(await prepare(input), input.fingerprints)

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
      {
        key: "DEFAULT_MINIMUM_TOKENS",
        name: "Default Minimum Tokens",
        placeholder: undefined,
        optional: true,
        secret: true,
      },
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
  test.each([
    ["frontmatter", "---\nname: demo\ndescription: Demo\n---\nBody"],
    ["plain Markdown", "# Demo\nBody"],
    ["omitted name", "---\ndescription: Demo\n---\nBody"],
    ["omitted description", "---\nname: demo\n---\nBody"],
    ["omitted name and description", "---\nmetadata: {}\n---\nBody"],
    ["display name", "---\nname: A Different Display Name\n---\nBody"],
    ["metadata flags", '---\nmetadata:\n  opencode/autoinvoke: "off"\ndisable-model-invocation: true\n---\nBody'],
    ["opaque metadata", "---\nmetadata: [custom, 123]\ndisable-model-invocation: custom\n---\nBody"],
    ["native YAML sanitization", "---\ndescription: Keywords: crawl, scrape\n---\nBody"],
  ])("accepts native-compatible %s without rewriting content", async (_, content) => {
    const directory = await tmp()
    try {
      const prepared = await prepare({
        root: path.join(directory, "skills"),
        id: "demo",
        archive: await tarball({ "repo/skills/demo/SKILL.md": content }),
        select: "demo",
      })
      expect(prepared.target).toBe(path.join(directory, "skills", "demo"))
      expect(new TextDecoder().decode(prepared.files[0].data)).toBe(content)
      expect(await fs.readdir(directory)).toEqual([])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test.each([
    ["name: 123", "frontmatter"],
    ["description: []", "frontmatter"],
    ["description: [unclosed", "markdown"],
  ])("rejects native-incompatible %s before writing", async (metadata, reason) => {
    const directory = await tmp()
    try {
      await expect(
        install({
          root: path.join(directory, "skills"),
          id: "demo",
          archive: await tarball({ "SKILL.md": `---\n${metadata}\n---\nprivate body` }),
        }),
      ).rejects.toMatchObject({ reason: "invalid", message: `Invalid skill demo: ${reason}` })
      expect(await fs.readdir(directory)).toEqual([])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test("retries partially deleted owned trash after a project move without rehashing it", async () => {
    const directory = await tmp()
    const root = path.join(directory, "original", "skills")
    const target = await install({
      root,
      id: "demo",
      archive: await tarball({ "SKILL.md": "owned", "ref/a.txt": "keep until deleted" }),
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
    expect((await fs.readdir(path.join(directory, "moved"))).toSorted()).toEqual([".marketplace-trash", "skills"])
    expect(await fs.readdir(path.join(directory, "moved", ".marketplace-trash"))).toEqual([])
  })

  test("replacement keeps the new tree and retries interrupted backup cleanup", async () => {
    const directory = await tmp()
    const root = path.join(directory, "skills")
    const target = await install({
      root,
      id: "demo",
      archive: await tarball({ "SKILL.md": "old", "ref/a.txt": "old reference" }),
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
      await expect(install({ root, id: "demo", archive, fingerprints: [owned] })).rejects.toBe(interrupted)
    } finally {
      failure.mockRestore()
    }
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toBe("new")
    expect((await fs.readdir(directory)).toSorted()).toEqual([".marketplace-trash", "skills"])
    await install({ root, id: "demo", archive, fingerprints: [owned, (await fingerprint(target))!] })
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toBe("new")
    expect(await fs.readdir(path.join(directory, ".marketplace-trash"))).toEqual([])
    await remove(target, [(await fingerprint(target))!])
  })

  test("restores the untouched old skill when promoting the staged replacement fails", async () => {
    const directory = await tmp()
    try {
      const root = path.join(directory, "skills")
      const target = await install({
        root,
        id: "demo",
        archive: await tarball({ "SKILL.md": "old", "ref/a.txt": "old reference" }),
      })
      const owned = (await fingerprint(target))!
      const original = fs.rename
      const denied = new Error("staging rename denied")
      using failure = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        if (String(source).includes(".marketplace-staging")) {
          const parent = path.join(directory, ".marketplace-trash")
          const backups = await fs.readdir(parent)
          expect(backups).toHaveLength(1)
          expect(await fingerprint(path.join(parent, backups[0]))).toBe(owned)
          throw denied
        }
        await original(source, destination)
      })
      await expect(
        install({ root, id: "demo", archive: await tarball({ "SKILL.md": "new" }), fingerprints: [owned] }),
      ).rejects.toBe(denied)
      expect(await fingerprint(target)).toBe(owned)
      expect(await Bun.file(path.join(target, "ref/a.txt")).text()).toBe("old reference")
      expect(await fs.readdir(path.join(directory, ".marketplace-trash"))).toEqual([])
      expect((await fs.readdir(directory)).toSorted()).toEqual([".marketplace-trash", "skills"])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test.each(["write", "remove"] as const)(
    "serializes concurrent %s through an alias until failed promotion restores the old tree",
    async (operation) => {
      const directory = await fs.realpath(await tmp())
      const resume = Promise.withResolvers<void>()
      try {
        const root = path.join(directory, "skills")
        const target = await install({
          root,
          id: "demo",
          archive: await tarball({ "SKILL.md": "old", "ref/a.txt": "old reference" }),
        })
        const owned = (await fingerprint(target))!
        const prepared = await prepare({ root, id: "demo", archive: await tarball({ "SKILL.md": "new" }) })
        const alias = path.join(directory, "alias")
        await fs.symlink(root, alias, "dir")
        const aliased = path.relative(process.cwd(), path.join(alias, "demo"))
        const entered = Promise.withResolvers<void>()
        const attempted = Promise.withResolvers<void>()
        const rename = fs.rename
        const realpath = fs.realpath
        const lstat = fs.lstat
        const denied = new Error("staging rename denied")
        const inspections: string[] = []
        const restored: (string | undefined)[] = []
        using promotion = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
          if (String(source).includes(".marketplace-staging")) {
            entered.resolve()
            await resume.promise
            throw denied
          }
          await rename(source, destination)
          if (String(source).includes(".marketplace-trash")) restored.push(await fingerprint(target))
        })
        const replacing = write(prepared, [owned]).catch((error: unknown) => error)
        await entered.promise
        using resolving = spyOn(fs, "realpath").mockImplementation((async (location) => {
          const result = await realpath(location)
          if (location === alias) attempted.resolve()
          return result
        }) as typeof fs.realpath)
        using inspecting = spyOn(fs, "lstat").mockImplementation(((location) => {
          if (
            path.resolve(String(location)) === target ||
            path.resolve(String(location)) === path.join(alias, "demo")
          ) {
            inspections.push(String(location))
            attempted.resolve()
          }
          return lstat(location)
        }) as typeof fs.lstat)
        const queued =
          operation === "write"
            ? write({ ...prepared, target: aliased }, [owned]).catch((error: unknown) => error)
            : remove(aliased, [owned])
        try {
          await attempted.promise
          // Drain queue dispatch microtasks after canonicalization, without a timing-based sleep.
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(inspections).toEqual([])
          const trash = path.join(directory, ".marketplace-trash")
          const backups = await fs.readdir(trash)
          expect(backups).toHaveLength(1)
          expect(await fingerprint(path.join(trash, backups[0]))).toBe(owned)
        } finally {
          resume.resolve()
          await Promise.all([replacing, queued])
        }
        expect(await replacing).toBe(denied)
        expect(await queued).toBe(operation === "write" ? denied : undefined)
        expect(restored).toEqual(operation === "write" ? [owned, owned] : [owned])
        expect(await fingerprint(target)).toBe(operation === "write" ? owned : undefined)
        if (operation === "write") {
          expect(await Bun.file(path.join(target, "ref/a.txt")).text()).toBe("old reference")
        }
        expect(await fs.readdir(path.join(directory, ".marketplace-trash"))).toEqual([])
        expect((await fs.readdir(directory)).toSorted()).toEqual([".marketplace-trash", "alias", "skills"])
        // A rejected operation must not poison later work on the target.
        await remove(target, [owned])
        expect(await fingerprint(target)).toBeUndefined()
      } finally {
        resume.resolve()
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
  )

  test("keeps failed rollback backups addressable by ownership after a project move", async () => {
    const directory = await tmp()
    try {
      const root = path.join(directory, "original", "skills")
      const target = await install({ root, id: "demo", archive: await tarball({ "SKILL.md": "old" }) })
      const owned = (await fingerprint(target))!
      const original = fs.rename
      const promotion = new Error("promotion failed")
      const rollback = new Error("rollback failed")
      const failure = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        if (String(source).includes(".marketplace-staging")) throw promotion
        if (String(source).includes(".marketplace-trash")) throw rollback
        await original(source, destination)
      })
      try {
        await expect(
          install({ root, id: "demo", archive: await tarball({ "SKILL.md": "new" }), fingerprints: [owned] }),
        ).rejects.toMatchObject({ errors: [promotion, rollback], cause: promotion })
      } finally {
        failure.mockRestore()
      }
      expect(await fingerprint(target)).toBeUndefined()
      const parent = path.join(directory, "original", ".marketplace-trash")
      const backups = await fs.readdir(parent)
      expect(backups).toHaveLength(1)
      expect(await fingerprint(path.join(parent, backups[0]))).toBe(owned)
      await fs.rename(path.join(directory, "original"), path.join(directory, "moved"))
      await remove(path.join(directory, "moved", "skills", "demo"), [owned])
      expect(await fs.readdir(path.join(directory, "moved", ".marketplace-trash"))).toEqual([])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test("concurrent resource cleanup retains the shared trash parent before another rename", async () => {
    const directory = await tmp()
    try {
      const root = path.join(directory, "skills")
      const first = await install({ root, id: "first", archive: await tarball({ "SKILL.md": "first" }) })
      const second = await install({ root, id: "second", archive: await tarball({ "SKILL.md": "second" }) })
      const firstOwned = (await fingerprint(first))!
      const secondOwned = (await fingerprint(second))!
      const canonical = await fs.realpath(second)
      const entered = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const original = fs.rename
      using paused = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
        if (source === canonical) {
          entered.resolve()
          await resume.promise
        }
        await original(source, destination)
      })
      const removing = remove(second, [secondOwned])
      await entered.promise
      try {
        await remove(first, [firstOwned])
      } finally {
        resume.resolve()
        await removing
      }
      expect(await fs.readdir(root)).toEqual([])
      expect(await fs.readdir(path.join(directory, ".marketplace-trash"))).toEqual([])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  test("fingerprints protect changed contents, added files, empty directories, and symbolic links", async () => {
    const root = path.join(await tmp(), "skills")
    const archive = await tarball({ "SKILL.md": "original", "ref/a.txt": "reference" })
    const target = await install({ root, id: "demo", archive })
    const owned = (await fingerprint(target))!
    await expect(remove(target)).rejects.toMatchObject({ reason: "conflict" })
    await expect(install({ root, id: "demo", archive })).rejects.toMatchObject({ reason: "conflict" })
    await Bun.write(path.join(target, "SKILL.md"), "edited")
    await expect(remove(target, [owned])).rejects.toMatchObject({ reason: "conflict" })
    await expect(install({ root, id: "demo", archive, fingerprints: [owned] })).rejects.toMatchObject({
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
    const target = await install({ root, id: "demo", archive })
    expect(target).toBe(path.join(root, "demo"))
    expect(await Bun.file(path.join(target, "SKILL.md")).text()).toContain("v1")
    expect(await fs.readdir(path.dirname(root))).toEqual(["skills"])

    await await expect(install({ root, id: "demo", archive })).rejects.toMatchObject({
      reason: "conflict",
    })

    await install({
      root,
      id: "demo",
      archive: await tarball({ "SKILL.md": "v2" }),
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
      install({ root, id: "../x", archive: await tarball({ "SKILL.md": "x" }) }),
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
    await expect(install({ root, id: "demo", archive })).rejects.toBeDefined()
    expect(await fs.readdir(directory)).toEqual([])
  })

  test("cleans staging when the skills root is not a directory", async () => {
    const directory = await tmp()
    // A file cannot be used as the skills root; failure occurs after staging is written.
    const blocked = path.join(directory, "blocked")
    await Bun.write(blocked, "not a directory")
    await expect(
      install({ root: blocked, id: "demo", archive: await tarball({ "SKILL.md": "new" }) }),
    ).rejects.toBeDefined()
    expect(await fs.readdir(directory)).toEqual(["blocked"])
    expect(await Bun.file(blocked).text()).toBe("not a directory")
  })
})
