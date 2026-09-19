import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { detect } from "../../src/kilocode/marketplace/detection"
import { install, remove } from "../../src/kilocode/marketplace/installer"
import { pluginPackageName } from "../../src/kilocode/marketplace/plugin-spec"
import { tmpdir } from "../fixture/fixture"

describe("marketplace plugin helpers", () => {
  test("extracts package names from plugin specs", () => {
    expect(pluginPackageName("opencode-models-discovery")).toBe("opencode-models-discovery")
    expect(pluginPackageName("opencode-models-discovery@1.2.3")).toBe("opencode-models-discovery")
    expect(pluginPackageName("@scope/plugin")).toBe("@scope/plugin")
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

  test("removes the plugin even when a sibling config is malformed", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilo")
    await mkdir(dir, { recursive: true })
    await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ plugin: ["other-plugin"] }))
    await Bun.write(path.join(dir, "tui.json"), "{ not valid json")

    const out = await Effect.runPromise(
      remove({ directory: tmp.path, worktree: tmp.path } as never, { id: "other-plugin", type: "plugin" }, "project"),
    )
    expect(out.success).toBe(true)
    const config = JSON.parse(await Bun.file(path.join(dir, "opencode.json")).text())
    expect(config.plugin).toEqual([])
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
