import { describe, expect, spyOn, test } from "bun:test"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "../../src/util/filesystem"
import { detect } from "../../src/kilocode/marketplace/detection"
import { install, remove } from "../../src/kilocode/marketplace/installer"
import { pluginPackageName } from "../../src/kilocode/marketplace/plugin-spec"
import { patchPlugin } from "../../src/kilocode/marketplace/plugin-config"
import { pluginFiles } from "../../src/kilocode/marketplace/paths"
import type { MarketplaceRemoveResult } from "../../src/kilocode/marketplace/schema"
import { tmpdir } from "../fixture/fixture"

describe("marketplace plugin helpers", () => {
  test("extracts package names from plugin specs", () => {
    expect(pluginPackageName("opencode-models-discovery")).toBe("opencode-models-discovery")
    expect(pluginPackageName("opencode-models-discovery@1.2.3")).toBe("opencode-models-discovery")
    expect(pluginPackageName("@scope/plugin")).toBe("@scope/plugin")
    expect(pluginPackageName("@scope/plugin@2.3.4")).toBe("@scope/plugin")
    expect(pluginPackageName(["@scope/plugin@next", { option: true }])).toBe("@scope/plugin")
    expect(pluginPackageName(["pkg", { option: true }])).toBe("pkg")
    expect(pluginPackageName("file:///tmp/plugin")).toBe("file:///tmp/plugin")
    expect(pluginPackageName(42)).toBeUndefined()
  })

  test("rejects plugin items whose id is not the package name", async () => {
    const out = await Effect.runPromise(
      install({} as never, {
        item: { type: "plugin", id: "slug", content: "opencode-models-discovery" },
        target: "project",
      }),
    )
    expect(out.success).toBe(false)
    expect(out.error).toContain("must match the package name")
  })

  test.each(["{ not valid json", '{"plugin":["other-plugin"], "bad": }'])(
    "reports incomplete removal with malformed sibling: %s",
    async (invalid) => {
      await using tmp = await tmpdir()
      const dir = path.join(tmp.path, ".kilo")
      await mkdir(dir, { recursive: true })
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["other-plugin"] }))
      await Bun.write(path.join(dir, "tui.json"), invalid)

      const out: MarketplaceRemoveResult = await Effect.runPromise(
        remove({ directory: tmp.path, worktree: tmp.path } as never, { id: "other-plugin", type: "plugin" }, "project"),
      )
      expect(out.success).toBe(false)
      expect(out.error).toContain("Removed from:")
      expect(out.error).toContain(path.join(dir, "tui.json"))
      expect(out.error).toContain("file left unchanged")
      expect(await Bun.file(path.join(dir, "tui.json")).text()).toBe(invalid)
      const config = JSON.parse(await Bun.file(path.join(dir, "opencode.json")).text())
      expect(config.plugin).toEqual([])
    },
  )

  test("detects and removes every project source from nested directories", async () => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "nested", "child")
    await mkdir(directory, { recursive: true })
    const files = [
      "kilo.json",
      "kilo.jsonc",
      "opencode.json",
      "opencode.jsonc",
      ".kilo/kilo.jsonc",
      ".kilo/opencode.json",
      ".kilo/tui.jsonc",
      ".kilocode/kilo.json",
      "nested/.kilo/opencode.jsonc",
      "nested/child/.kilo/kilo.json",
      "nested/child/.kilo/tui.json",
    ].map((file) => path.join(tmp.path, file))
    for (const file of files) {
      await Bun.write(
        file,
        '// keep this comment\n{"plugin": [["@scope/plugin@1.2.3", {"enabled": true}], "other@2"],}',
      )
    }
    const input = { directory, worktree: tmp.path, vcs: "git" }
    const sources = pluginFiles("project", directory, tmp.path)
    for (const file of files) expect(sources).toContain(file)
    expect((await detect(input)).project["plugin:@scope/plugin"]).toBeDefined()
    expect(
      (await Effect.runPromise(remove(input as never, { id: "@scope/plugin", type: "plugin" }, "project"))).success,
    ).toBe(true)
    for (const file of files) {
      const text = await Bun.file(file).text()
      expect(text).toContain("// keep this comment")
      expect(parse(text).plugin).toEqual(["other@2"])
    }
    expect((await detect(input)).project["plugin:@scope/plugin"]).toBeUndefined()
    expect(
      (await Effect.runPromise(remove(input as never, { id: "@scope/plugin", type: "plugin" }, "project"))).success,
    ).toBe(true)
  })

  test.each(["absent", "root", "unrelated"])("confines project plugins with %s worktree", async (mode) => {
    await using tmp = await tmpdir()
    const directory = path.join(tmp.path, "project-child")
    // This sibling is also a string prefix of directory, but is not its ancestor.
    const sibling = path.join(tmp.path, "project")
    const outside = [path.join(tmp.path, ".kilo", "opencode.json"), path.join(sibling, ".kilo", "tui.json")]
    const text = '{"plugin":["pkg@1", "outside-project"]}'
    for (const file of outside) await Bun.write(file, text)
    const file = path.join(directory, ".kilo", "opencode.json")
    await Bun.write(file, '{"plugin":["pkg@1"]}')
    const worktree = mode === "absent" ? undefined : mode === "root" ? path.parse(tmp.path).root : sibling
    const input = { directory, worktree }
    const sources = pluginFiles("project", directory, worktree)
    for (const file of outside) expect(sources).not.toContain(file)
    const before = await detect(input)
    expect(before.project["plugin:pkg"]).toBeDefined()
    expect(before.project["plugin:outside-project"]).toBeUndefined()
    expect((await Effect.runPromise(remove(input as never, { id: "pkg", type: "plugin" }, "project"))).success).toBe(
      true,
    )
    expect((await Bun.file(file).json()).plugin).toEqual([])
    for (const file of outside) expect(await Bun.file(file).text()).toBe(text)
    const after = await detect(input)
    expect(after.project["plugin:pkg"]).toBeUndefined()
    expect(after.project["plugin:outside-project"]).toBeUndefined()
  })

  test("detects and removes all global overlay and runtime config variants", async () => {
    await using tmp = await tmpdir()
    const input = { directory: tmp.path, worktree: tmp.path }
    const files = pluginFiles("global", tmp.path, tmp.path)
    const originals = await Promise.all(
      files.map(async (file) => ({
        file,
        text: await Bun.file(file)
          .text()
          .catch((err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") return undefined
            throw err
          }),
      })),
    )
    try {
      for (const file of files) await Bun.write(file, '{"plugin":["@scope/global-plugin@next"]}')
      expect(files).toContain(path.join(Global.Path.config, "kilo.json"))
      expect(files).toContain(path.join(Global.Path.config, "kilo.jsonc"))
      expect((await detect(input)).global["plugin:@scope/global-plugin"]).toBeDefined()
      expect(
        (await Effect.runPromise(remove(input as never, { id: "@scope/global-plugin", type: "plugin" }, "global")))
          .success,
      ).toBe(true)
      for (const file of files) expect((await Bun.file(file).json()).plugin).toEqual([])
      expect((await detect(input)).global["plugin:@scope/global-plugin"]).toBeUndefined()
    } finally {
      for (const { file, text } of originals) {
        if (text !== undefined) {
          await Bun.write(file, text)
          continue
        }
        await rm(file, { force: true })
      }
    }
  })

  test("does not mask a removal write failure and succeeds on retry", async () => {
    await using tmp = await tmpdir()
    const input = { directory: tmp.path, worktree: tmp.path }
    const first = path.join(tmp.path, ".kilo", "opencode.json")
    const second = path.join(tmp.path, ".kilo", "tui.json")
    for (const file of [first, second]) await Bun.write(file, '{"plugin":["@scope/plugin@1", "other"]}')
    const write = Filesystem.write
    // Inject only the OS write failure, because chmod is ineffective as root.
    const spy = spyOn(Filesystem, "write").mockImplementation(async (file, text, mode) => {
      if (file === second) throw new Error("EACCES: test write denied")
      return write(file, text, mode)
    })
    try {
      const out: MarketplaceRemoveResult = await Effect.runPromise(
        remove(input as never, { id: "@scope/plugin", type: "plugin" }, "project"),
      )
      expect(out.success).toBe(false)
      expect(out.error).toContain(first)
      expect(out.error).toContain(second)
      expect(out.error).toContain("EACCES")
      expect((await Bun.file(first).json()).plugin).toEqual(["other"])
      expect((await Bun.file(second).json()).plugin).toEqual(["@scope/plugin@1", "other"])
      expect((await detect(input)).project["plugin:@scope/plugin"]).toBeDefined()
    } finally {
      spy.mockRestore()
    }
    expect(
      (await Effect.runPromise(remove(input as never, { id: "@scope/plugin", type: "plugin" }, "project"))).success,
    ).toBe(true)
    expect((await detect(input)).project["plugin:@scope/plugin"]).toBeUndefined()
  })

  test("does not hide an unreadable config behind a successful removal", async () => {
    await using tmp = await tmpdir()
    const input = { directory: tmp.path, worktree: tmp.path }
    const file = path.join(tmp.path, ".kilo", "opencode.json")
    const blocked = path.join(tmp.path, ".kilo", "tui.json")
    await Bun.write(file, '{"plugin":["pkg@1"]}')
    // A directory produces a real read error, including when tests run as root.
    await mkdir(blocked)
    const out: MarketplaceRemoveResult = await Effect.runPromise(
      remove(input as never, { id: "pkg", type: "plugin" }, "project"),
    )
    expect(out.success).toBe(false)
    expect(out.error).toContain(blocked)
    expect((await Bun.file(file).json()).plugin).toEqual([])
    await rm(blocked, { recursive: true })
    expect((await Effect.runPromise(remove(input as never, { id: "pkg", type: "plugin" }, "project"))).success).toBe(
      true,
    )
  })

  test.each(["{ malformed", "[]", '{"plugin":true}'])(
    "preflights both install targets before changes: %s",
    async (invalid) => {
      await using tmp = await tmpdir()
      const server = path.join(tmp.path, ".kilo", "opencode.jsonc")
      const tui = path.join(tmp.path, ".kilo", "tui.json")
      const text = '// preserve me\n{"plugin":["other"],}'
      await Bun.write(server, text)
      await Bun.write(tui, invalid)
      const input = {
        directory: tmp.path,
        worktree: tmp.path,
        spec: "@scope/plugin@1",
        targets: [{ kind: "server" as const }, { kind: "tui" as const }],
      }
      const out = await patchPlugin(input)
      expect(out.success).toBe(false)
      if (!out.success) expect(out.error).toContain(tui)
      expect(await Bun.file(server).text()).toBe(text)
      expect(await Bun.file(tui).text()).toBe(invalid)
      await Bun.write(tui, "{}")
      const retry = await patchPlugin(input)
      expect(retry.success).toBe(true)
      if (retry.success) expect(retry.files).toEqual([server, tui])
      expect(parse(await Bun.file(server).text()).plugin).toEqual(["other", "@scope/plugin@1"])
      expect((await Bun.file(tui).json()).plugin).toEqual(["@scope/plugin@1"])
    },
  )

  test("reports actual partial install writes and retries without duplicate package identities", async () => {
    await using tmp = await tmpdir()
    const server = path.join(tmp.path, ".kilo", "opencode.json")
    const tui = path.join(tmp.path, ".kilo", "tui.json")
    const input = {
      directory: tmp.path,
      worktree: tmp.path,
      spec: "@scope/plugin@1.2.3",
      targets: [{ kind: "server" as const, opts: { enabled: true } }, { kind: "tui" as const }],
    }
    const out = await patchPlugin(input, async (file, text) => {
      if (file === tui) throw new Error("EACCES: test write denied")
      await Filesystem.write(file, text)
    })
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.error).toContain(`Updated config files: ${server}`)
      expect(out.error).toContain(`Failed config writes (files may have changed): ${tui}`)
      expect(out.error).toContain("EACCES")
    }
    expect((await Bun.file(server).json()).plugin).toEqual([["@scope/plugin@1.2.3", { enabled: true }]])
    expect(await Bun.file(tui).exists()).toBe(false)
    // The same package under another version remains a no-op in the first target.
    const retry = await patchPlugin({ ...input, spec: "@scope/plugin@next" })
    expect(retry.success).toBe(true)
    expect((await Bun.file(server).json()).plugin).toEqual([["@scope/plugin@1.2.3", { enabled: true }]])
    expect((await Bun.file(tui).json()).plugin).toEqual(["@scope/plugin@next"])
    expect((await patchPlugin(input)).success).toBe(true)
    expect((await Bun.file(tui).json()).plugin).toEqual(["@scope/plugin@next"])
  })

  test("detects installed plugins from project config", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilo")
    await mkdir(dir, { recursive: true })
    await Bun.write(
      path.join(dir, "opencode.json"),
      JSON.stringify({ plugin: ["opencode-models-discovery", ["other-plugin", {}]] }),
    )

    const out = await detect({ directory: tmp.path, worktree: tmp.path })
    expect(out.project["plugin:opencode-models-discovery"]).toEqual({ type: "plugin" })
    expect(out.project["plugin:other-plugin"]).toEqual({ type: "plugin" })
    expect(out.project["plugin:missing"]).toBeUndefined()
  })
})
