// kilocode_change - new file
import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { Global } from "@opencode-ai/core/global"
import { KilocodePaths } from "../../../src/kilocode/paths"

describe("ConfigProtection.isRequest", () => {
  const config = path.resolve(Global.Path.config)
  const legacy = KilocodePaths.globalDirs().map((d) => path.resolve(d))

  // --- external_directory: bash-originated (empty metadata) ---

  test("returns true for bash external_directory targeting global config", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: [config + "/*"],
      metadata: {},
    })
    expect(result).toBe(true)
  })

  test("returns true for bash external_directory targeting skill dir", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: [path.join(config, "skills", "my-skill") + "/*"],
      metadata: {},
    })
    expect(result).toBe(true)
  })

  test("returns true for bash external_directory targeting legacy global dir", () => {
    for (const dir of legacy) {
      const result = ConfigProtection.isRequest({
        permission: "external_directory",
        patterns: [dir + "/*"],
        metadata: {},
      })
      expect(result).toBe(true)
    }
  })

  // --- external_directory: file-tool-originated (has metadata.filepath) ---

  test("returns false for file-tool external_directory targeting global config", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: [config + "/*"],
      metadata: { filepath: path.join(config, "kilo.json"), parentDir: config },
    })
    expect(result).toBe(false)
  })

  test("returns false for file-tool external_directory targeting global config root dir", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: [config + "/*"],
      metadata: { filepath: config, parentDir: config },
    })
    expect(result).toBe(false)
  })

  test("returns false for file-tool external_directory targeting readable global command dir", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: [path.join(config, "command") + "/*"],
      metadata: { filepath: path.join(config, "command", "foo.md"), parentDir: path.join(config, "command") },
    })
    expect(result).toBe(false)
  })

  test("returns false for file-tool external_directory targeting readable global skill dir", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: [path.join(config, "skills") + "/*"],
      metadata: {
        filepath: path.join(config, "skills", "my-skill", "SKILL.md"),
        parentDir: path.join(config, "skills"),
      },
    })
    expect(result).toBe(false)
  })

  // --- external_directory: non-config dirs ---

  test("returns false for bash external_directory targeting non-config dir", () => {
    const result = ConfigProtection.isRequest({
      permission: "external_directory",
      patterns: ["/tmp/some-project/*"],
      metadata: {},
    })
    expect(result).toBe(false)
  })

  // --- edit permission ---

  test("returns true for edit targeting global config file via metadata.filepath", () => {
    const result = ConfigProtection.isRequest({
      permission: "edit",
      patterns: [],
      metadata: { filepath: path.join(config, "config.json") },
    })
    expect(result).toBe(true)
  })

  test("returns true for edit targeting skill file via metadata.filepath", () => {
    const result = ConfigProtection.isRequest({
      permission: "edit",
      patterns: [],
      metadata: { filepath: path.join(config, "skills", "my-skill", "SKILL.md") },
    })
    expect(result).toBe(true)
  })

  test("returns true for edit targeting legacy global dir via metadata.filepath", () => {
    for (const dir of legacy) {
      const result = ConfigProtection.isRequest({
        permission: "edit",
        patterns: [],
        metadata: { filepath: path.join(dir, "config.json") },
      })
      expect(result).toBe(true)
    }
  })

  test("returns true for edit targeting relative config path via patterns", () => {
    const result = ConfigProtection.isRequest({
      permission: "edit",
      patterns: [".kilo/command/foo.md"],
    })
    expect(result).toBe(true)
  })

  test("returns false for edit targeting excluded subdir (plans)", () => {
    const result = ConfigProtection.isRequest({
      permission: "edit",
      patterns: [".kilo/plans/plan.md"],
    })
    expect(result).toBe(false)
  })

  test("returns false for read permission", () => {
    const result = ConfigProtection.isRequest({
      permission: "read",
      patterns: [".kilo/config.json"],
    })
    expect(result).toBe(false)
  })

  test("returns false for bash permission", () => {
    const result = ConfigProtection.isRequest({
      permission: "bash",
      patterns: ["cat " + path.join(config, "config.json")],
    })
    expect(result).toBe(false)
  })

  test("returns true for edit targeting root config files", () => {
    for (const file of ["kilo.json", "kilo.jsonc", "AGENTS.md"]) {
      const result = ConfigProtection.isRequest({
        permission: "edit",
        patterns: [file],
      })
      expect(result).toBe(true)
    }
  })

  test("returns false for edit targeting non-config files", () => {
    const result = ConfigProtection.isRequest({
      permission: "edit",
      patterns: ["src/index.ts"],
    })
    expect(result).toBe(false)
  })

  test("protects package lock files in project config directories", () => {
    for (const file of [".kilo/package-lock.json", ".kilocode/package-lock.json"]) {
      expect(ConfigProtection.isRequest({ permission: "edit", patterns: [file] })).toBe(true)
    }
  })

  test("protects a combined source and config lockfile edit", () => {
    expect(
      ConfigProtection.isRequest({
        permission: "edit",
        patterns: ["src/app/layout.tsx", ".kilo/package-lock.json", ".kilocode/package-lock.json"],
        metadata: {
          filepath: "src/app/layout.tsx, .kilo/package-lock.json, .kilocode/package-lock.json",
        },
      }),
    ).toBe(true)
  })
})

describe("ConfigProtection.isGlobalSkillRequest", () => {
  const roots = [Global.Path.config, ...KilocodePaths.globalDirs()]

  test("allows one exact global skill subtree", () => {
    for (const root of roots) {
      const pattern = path.join(root, "skills", "axiom-sre", "*")
      expect({
        root,
        result: ConfigProtection.isGlobalSkillRequest({
          permission: "external_directory",
          patterns: [pattern],
        }),
      }).toEqual({ root, result: true })
    }
  })

  test("allows multiple paths within the same global skill", () => {
    const root = path.join(roots[1], "skills", "axiom-sre")
    const patterns = [path.join(root, "*"), path.join(root, "scripts", "*")]
    expect(ConfigProtection.isGlobalSkillRequest({ permission: "external_directory", patterns })).toBe(true)
    expect(ConfigProtection.globalSkillPattern({ permission: "external_directory", patterns })).toBe(
      path.join(root, "*").replaceAll("\\", "/"),
    )
  })

  test("rejects broad, mixed, edit, and mismatched requests", () => {
    const root = path.join(roots[1], "skills")
    const first = path.join(root, "axiom-sre", "*")
    const second = path.join(root, "other", "*")
    expect(
      ConfigProtection.isGlobalSkillRequest({
        permission: "external_directory",
        patterns: [path.join(root, "*")],
      }),
    ).toBe(false)
    expect(ConfigProtection.isGlobalSkillRequest({ permission: "external_directory", patterns: [first, second] })).toBe(
      false,
    )
    expect(ConfigProtection.isGlobalSkillRequest({ permission: "edit", patterns: [first] })).toBe(false)
    expect(ConfigProtection.globalSkillPattern({ permission: "external_directory", patterns: [first] })).toBe(
      first.replaceAll("\\", "/"),
    )
  })

  test("rejects symlink escapes from a global skill", async () => {
    const skills = path.join(Global.Path.config, "skills")
    const outside = path.join(Global.Path.config, "outside")
    const root = path.join(skills, "linked-skill")
    const nested = path.join(skills, "nested-skill")
    await fs.mkdir(outside, { recursive: true })
    await fs.mkdir(nested, { recursive: true })
    const type = process.platform === "win32" ? "junction" : "dir"
    await fs.symlink(outside, root, type)
    await fs.symlink(outside, path.join(nested, "link"), type)

    try {
      expect(
        ConfigProtection.globalSkillPattern({
          permission: "external_directory",
          patterns: [path.join(root, "*")],
        }),
      ).toBeUndefined()
      expect(
        ConfigProtection.globalSkillPattern({
          permission: "external_directory",
          patterns: [path.join(nested, "link", "*")],
        }),
      ).toBeUndefined()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(nested, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
