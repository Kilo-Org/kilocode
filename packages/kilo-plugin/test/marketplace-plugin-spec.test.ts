import { describe, expect, test } from "bun:test"
import { pluginIdentity } from "../src/marketplace/plugin-spec"

describe("plugin identity", () => {
  test.each([
    ["kilo-plugin", "kilo-plugin"],
    ["kilo-plugin@1.2.3", "kilo-plugin"],
    ["kilo-plugin@latest", "kilo-plugin"],
    ["@scope/plugin@^2", "@scope/plugin"],
    ["@scope/plugin", "@scope/plugin"],
    ["github:user/repo", "github:user/repo"],
    ["  kilo-plugin@1.2.3  ", "kilo-plugin"],
    ["git:https://github.com/user/repo.git", "git/github.com/user/repo"],
    ["git:https://github.com/user/repo.git@main", "git/github.com/user/repo"],
    ["git:https://github.com/user/repo.git@main#packages/plugin", "git/github.com/user/repo/packages/plugin"],
    ["file:///tmp/plugin", "file:///tmp/plugin"],
    ["/tmp/plugin", "/tmp/plugin"],
  ])("resolves %s to %s", async (spec, identity) => {
    expect(await pluginIdentity(spec)).toBe(identity)
  })
  // A v1 config held `[spec, options]` tuples, and v2 holds `{ package, options }` entries. Both are read from
  // raw config JSON, so an install can own an entry written in either shape.
  test("accepts tuple and v2 entry forms", async () => {
    expect(await pluginIdentity(["kilo-plugin@1", { mode: "server" }])).toEqual("kilo-plugin")
    expect(await pluginIdentity({ package: "kilo-plugin@1", options: {} })).toEqual("kilo-plugin")
    expect(await pluginIdentity({ package: "@scope/plugin" })).toEqual("@scope/plugin")
  })
  test("rejects empty and unusable values", async () => {
    expect(await pluginIdentity(undefined)).toBeUndefined()
    expect(await pluginIdentity(null)).toBeUndefined()
    expect(await pluginIdentity(42)).toBeUndefined()
    expect(await pluginIdentity("")).toBeUndefined()
    expect(await pluginIdentity("   ")).toBeUndefined()
    expect(await pluginIdentity([])).toBeUndefined()
    expect(await pluginIdentity({ options: {} })).toBeUndefined()
  })
  test("keeps an unparseable npm spec as its own identity instead of dropping it", async () => {
    expect(await pluginIdentity("not a valid spec!!")).toEqual("not a valid spec!!")
  })
  test("keys an npm alias by the name it installs as, not the real package", async () => {
    expect(await pluginIdentity("alias@npm:kilo-plugin@1")).toEqual("alias")
  })
})
