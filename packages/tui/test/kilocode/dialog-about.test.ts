import { expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client"
import { diagnostics, effectiveConfigPath, maskPath, runtime } from "../../src/kilocode/dialog-about"

const base = {
  version: "1.2.3",
  channel: "dev",
  runtime: "Bun 1.2.3",
  platform: "darwin",
  arch: "arm64",
  configPath: "/home/user/.config/kilo2/kilo2.json",
  projectPath: "/home/user/code/project",
  providers: "kilo",
  defaultModel: "kilo/kilo-auto/free",
  home: "/home/user",
  privacy: false,
}

test("diagnostics renders the version, runtime, paths, providers and default model", () => {
  expect(diagnostics(base)).toBe(
    [
      "Kilo CLI 1.2.3 (dev)",
      "Runtime: Bun 1.2.3 (darwin/arm64)",
      "Config: ~/.config/kilo2/kilo2.json",
      "Project: ~/code/project",
      "Providers: kilo",
      "Default model: kilo/kilo-auto/free",
    ].join("\n"),
  )
})

test("diagnostics falls back to (none) for a missing default model", () => {
  expect(diagnostics({ ...base, defaultModel: "" })).toContain("Default model: (none)")
})

test("diagnostics masks the paths and notes privacy mode", () => {
  const text = diagnostics({ ...base, privacy: true })
  expect(text).toContain("Config: \u2022\u2022\u2022")
  expect(text).toContain("Project: \u2022\u2022\u2022")
  expect(text).toContain("Providers: kilo")
  expect(text).toContain("Default model: kilo/kilo-auto/free")
  expect(text).not.toContain("/home/user")
  expect(text.endsWith("(paths hidden \u2014 privacy_mode is on)")).toBe(true)
})

test("maskPath abbreviates home and truncates to 60 characters", () => {
  expect(maskPath("/home/user/code/project", false, "/home/user")).toBe("~/code/project")
  expect(maskPath("/other/absolute/path", false, "/home/user")).toBe("/other/absolute/path")
  const long = maskPath("/home/user/" + "a".repeat(80), false, "/home/user")
  expect(long.length).toBe(60)
  expect(long.endsWith("\u2026")).toBe(true)
})

test("maskPath hides the path when privacy mode is on", () => {
  expect(maskPath("/home/user/code/project", true, "/home/user")).toBe("\u2022\u2022\u2022")
})

test("runtime reports the Bun version when available", () => {
  expect(runtime()).toMatch(/^(Bun|Node) \d+\.\d+\.\d+/)
})

test("the config path is the highest-precedence document with a path", () => {
  const entries = [
    { type: "document", path: "/etc/kilo2.jsonc", info: {} },
    { type: "document", info: {} },
    { type: "document", path: "/home/user/.config/kilo2/kilo2.json", info: {} },
  ] as unknown as ConfigEntry[]
  expect(effectiveConfigPath(entries)).toBe("/home/user/.config/kilo2/kilo2.json")
  expect(effectiveConfigPath([])).toBeUndefined()
})
