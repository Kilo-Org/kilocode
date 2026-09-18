import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { detect } from "../../src/kilocode/marketplace/detection"
import { pluginPackageName } from "../../src/kilocode/marketplace/installer"
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
