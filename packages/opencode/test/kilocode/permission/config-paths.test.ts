// kilocode_change - new file
import path from "path"
import os from "os"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { Global } from "@opencode-ai/core/global"
import { KilocodePaths } from "../../../src/kilocode/paths"
import { tmpdir } from "../../fixture/fixture"

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

describe("ConfigProtection.enabled", () => {
  test("defaults on when the global value is absent or true", () => {
    expect(ConfigProtection.enabled(undefined)).toBe(true)
    expect(ConfigProtection.enabled({})).toBe(true)
    expect(ConfigProtection.enabled({ require_approval_for_config_edits: true })).toBe(true)
  })

  test("only an explicit global false disables protection", () => {
    expect(ConfigProtection.enabled({ require_approval_for_config_edits: false })).toBe(false)
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
    expect(ConfigProtection.globalSkillPattern({ permission: "external_directory", patterns })).toMatch(
      /\/skills\/axiom-sre\/\*$/,
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

  test("canonicalizes aliases to the physical global skill root", async () => {
    await using globalTmp = await tmpdir()
    await using aliasTmp = await tmpdir()
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = globalTmp.path
    const skill = path.join(globalTmp.path, "skills", "canonical-skill")
    const alias = path.join(aliasTmp.path, "alias")
    await fs.mkdir(skill, { recursive: true })
    await fs.symlink(skill, alias, process.platform === "win32" ? "junction" : "dir")

    try {
      const request = { permission: "external_directory", patterns: [path.join(alias, "*")] }
      const pattern = ConfigProtection.globalSkillPattern(request)
      expect(pattern).toMatch(/\/skills\/canonical-skill\/\*$/)
      expect(pattern).not.toContain(aliasTmp.path.replaceAll("\\", "/"))
      expect(ConfigProtection.isRequest(request)).toBe(true)
    } finally {
      ;(Global.Path as { config: string }).config = prev
      await fs.rm(alias, { recursive: true, force: true })
    }
  })

  test("rejects glob characters in the canonical rule", async () => {
    await using tmp = await tmpdir()
    const prev = process.env.XDG_CONFIG_HOME
    const root = path.join(tmp.path, "profile[")
    const skill = path.join(root, "kilo", "skills", "unsafe-root")
    process.env.XDG_CONFIG_HOME = root
    await fs.mkdir(skill, { recursive: true })

    try {
      expect(
        ConfigProtection.globalSkillPattern({
          permission: "external_directory",
          patterns: [path.join(skill, "*")],
        }),
      ).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = prev
    }
  })
})

describe("ConfigProtection.boundary", () => {
  test("uses the git worktree when present", () => {
    expect(ConfigProtection.boundary({ directory: "/a/b", worktree: "/a" })).toBe("/a")
  })

  test("falls back to the directory for non-git projects", () => {
    expect(ConfigProtection.boundary({ directory: "/a/b", worktree: "/" })).toBe("/a/b")
    expect(ConfigProtection.boundary({ directory: "/a/b" })).toBe("/a/b")
  })
})

describe("ConfigProtection.evaluate", () => {
  const global = path.resolve(Global.Path.config)
  const link = process.platform === "win32" ? "junction" : "dir"

  const verdict = (file: string, root: string, g?: object, p?: object) =>
    ConfigProtection.evaluate(
      { permission: "edit", patterns: [file], metadata: { filepath: file } },
      { root, global: g, project: p },
    )

  test("uses the project policy for config targets inside the boundary", async () => {
    await using tmp = await tmpdir()
    expect(verdict(".kilo/kilo.json", tmp.path, undefined, { require_approval_for_config_edits: false })).toMatchObject(
      {
        candidate: true,
        external: false,
        protect: false,
      },
    )
    expect(
      verdict("packages/sub/.kilo/config.json", tmp.path, undefined, { require_approval_for_config_edits: true }),
    ).toMatchObject({ candidate: true, external: false, protect: true })
  })

  test("global false with project true re-enables protection for inside targets", async () => {
    await using tmp = await tmpdir()
    expect(
      verdict(
        ".kilo/kilo.json",
        tmp.path,
        { require_approval_for_config_edits: false },
        {
          require_approval_for_config_edits: true,
        },
      ),
    ).toMatchObject({ candidate: true, external: false, protect: true })
  })

  test("uses the global policy for absolute global config targets", async () => {
    await using tmp = await tmpdir()
    expect(
      verdict(path.join(global, "kilo.json"), tmp.path, undefined, {
        require_approval_for_config_edits: false,
      }),
    ).toMatchObject({ candidate: true, external: true, protect: true })
  })

  test("uses the global policy for sibling absolute and traversal targets", async () => {
    await using tmp = await tmpdir()
    const sibling = path.join(os.tmpdir(), "opencode-eval-sibling", ".kilo", "kilo.json")
    expect(verdict(sibling, tmp.path, undefined, { require_approval_for_config_edits: false })).toMatchObject({
      candidate: true,
      external: true,
      protect: true,
    })
    expect(
      verdict("../sibling/.kilo/kilo.json", tmp.path, undefined, { require_approval_for_config_edits: false }),
    ).toMatchObject({ candidate: true, external: true, protect: true })
  })

  test("protects mixed requests when any target is external", async () => {
    await using tmp = await tmpdir()
    const result = ConfigProtection.evaluate(
      {
        permission: "edit",
        patterns: [".kilo/a.json", "../sib/.kilo/b.json"],
        metadata: { filepath: ".kilo/a.json, ../sib/.kilo/b.json" },
      },
      { root: tmp.path, global: undefined, project: { require_approval_for_config_edits: false } },
    )
    expect(result).toMatchObject({ candidate: true, external: true, protect: true })
  })

  test("does not protect nested AGENTS.md or ordinary files", async () => {
    await using tmp = await tmpdir()
    expect(verdict("src/AGENTS.md", tmp.path).candidate).toBe(false)
    expect(verdict("src/index.ts", tmp.path).candidate).toBe(false)
  })

  test("protects root config files inside the boundary under the project policy", async () => {
    await using tmp = await tmpdir()
    expect(verdict("AGENTS.md", tmp.path, undefined, { require_approval_for_config_edits: false })).toMatchObject({
      candidate: true,
      external: false,
      protect: false,
    })
  })

  test("ignores file-tool external_directory requests", async () => {
    await using tmp = await tmpdir()
    const result = ConfigProtection.evaluate(
      {
        permission: "external_directory",
        patterns: [global + "/*"],
        metadata: { filepath: path.join(global, "kilo.json") },
      },
      { root: tmp.path },
    )
    expect(result.candidate).toBe(false)
  })

  test("treats a symlinked global directory inside the project as global", async () => {
    await using tmp = await tmpdir()
    const alias = path.join(tmp.path, "global-link")
    await fs.symlink(global, alias, link)
    try {
      expect(
        verdict(path.join(alias, "kilo.json"), tmp.path, undefined, {
          require_approval_for_config_edits: false,
        }),
      ).toMatchObject({ candidate: true, external: true, protect: true })
    } finally {
      await fs.rm(alias, { recursive: true, force: true })
    }
  })

  test("treats symlink escapes and nonexistent leaves under them as external", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    const escape = path.join(tmp.path, "escape")
    await fs.symlink(outside.path, escape, link)
    try {
      expect(
        verdict(path.join(escape, ".kilo", "kilo.json"), tmp.path, undefined, {
          require_approval_for_config_edits: false,
        }),
      ).toMatchObject({ candidate: true, external: true, protect: true })
      expect(
        verdict(path.join(escape, "nested", ".kilo", "kilo.json"), tmp.path, undefined, {
          require_approval_for_config_edits: false,
        }),
      ).toMatchObject({ candidate: true, external: true, protect: true })
    } finally {
      await fs.rm(escape, { recursive: true, force: true })
    }
  })

  test("treats a relative path into a global config dir inside the boundary as global", async () => {
    await using tmp = await tmpdir()
    const prev = Global.Path.config
    const inner = path.join(tmp.path, ".config", "kilo")
    await fs.mkdir(inner, { recursive: true })
    ;(Global.Path as { config: string }).config = inner
    try {
      const result = ConfigProtection.evaluate(
        { permission: "edit", patterns: [".config/kilo/kilo.json"], metadata: { filepath: ".config/kilo/kilo.json" } },
        { root: tmp.path, global: undefined, project: { require_approval_for_config_edits: false } },
      )
      expect(result).toMatchObject({ candidate: true, external: true, protect: true })
    } finally {
      ;(Global.Path as { config: string }).config = prev
    }
  })

  test("does not treat a shared-prefix sibling as inside", async () => {
    await using tmp = await tmpdir()
    expect(
      verdict(path.join(tmp.path + "-evil", ".kilo", "kilo.json"), tmp.path, undefined, {
        require_approval_for_config_edits: false,
      }),
    ).toMatchObject({ candidate: true, external: true, protect: true })
  })

  test("uses the project policy for an outside alias that canonically lands inside the boundary", async () => {
    await using tmp = await tmpdir()
    const project = path.join(tmp.path, "project")
    await fs.mkdir(project, { recursive: true })
    const alias = path.join(tmp.path, "alias")
    await fs.symlink(project, alias, link)
    const off = { require_approval_for_config_edits: false }
    const on = { require_approval_for_config_edits: true }
    try {
      // Global false, project true: the canonical target is protected inside the project.
      expect(verdict(path.join(alias, ".kilo", "kilo.json"), project, off, on)).toMatchObject({
        candidate: true,
        external: false,
        protect: true,
      })
      expect(verdict(path.join(alias, "AGENTS.md"), project, off, on)).toMatchObject({
        candidate: true,
        external: false,
        protect: true,
      })
    } finally {
      await fs.rm(alias, { recursive: true, force: true })
    }
  })

  test("uses the global policy when an inside alias canonically escapes the boundary", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    const escape = path.join(tmp.path, "escape")
    await fs.symlink(outside.path, escape, link)
    try {
      expect(
        verdict(
          path.join(escape, ".kilo", "kilo.json"),
          tmp.path,
          { require_approval_for_config_edits: true },
          { require_approval_for_config_edits: false },
        ),
      ).toMatchObject({ candidate: true, external: true, protect: true })
    } finally {
      await fs.rm(escape, { recursive: true, force: true })
    }
  })

  test("follows an alias to a physical protected config path inside the boundary", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const alias = path.join(tmp.path, "configs")
    await fs.symlink(path.join(tmp.path, ".kilo"), alias, link)
    try {
      expect(
        verdict(
          path.join(alias, "kilo.json"),
          tmp.path,
          { require_approval_for_config_edits: false },
          { require_approval_for_config_edits: true },
        ),
      ).toMatchObject({ candidate: true, external: false, protect: true })
      expect(
        verdict(
          path.join(alias, "kilo.json"),
          tmp.path,
          { require_approval_for_config_edits: true },
          { require_approval_for_config_edits: false },
        ),
      ).toMatchObject({ candidate: true, external: false, protect: false })
    } finally {
      await fs.rm(alias, { recursive: true, force: true })
    }
  })

  test("does not protect arbitrary config-looking filenames outside the boundary", async () => {
    await using tmp = await tmpdir()
    const project = { require_approval_for_config_edits: false }
    const sibling = path.join(os.tmpdir(), "opencode-eval-sibling-root", "AGENTS.md")
    const siblingKilo = path.join(os.tmpdir(), "opencode-eval-sibling-root", "kilo.json")
    const traversal = "../opencode-eval-sibling-root/AGENTS.md"
    expect(verdict(sibling, tmp.path, undefined, project).candidate).toBe(false)
    expect(verdict(siblingKilo, tmp.path, undefined, project).candidate).toBe(false)
    expect(verdict(traversal, tmp.path, undefined, project).candidate).toBe(false)
  })

  test("keeps protection when a project config path symlinks to an ordinary same-project file", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "settings.json"), "{}")
    await fs.writeFile(path.join(tmp.path, "instructions.md"), "x")
    const dotKilo = path.join(tmp.path, ".kilo", "kilo.json")
    const agents = path.join(tmp.path, "AGENTS.md")
    await fs.symlink(path.join(tmp.path, "settings.json"), dotKilo, "file")
    await fs.symlink(path.join(tmp.path, "instructions.md"), agents, "file")
    const off = { require_approval_for_config_edits: false }
    const on = { require_approval_for_config_edits: true }
    try {
      // Default and global-false/project-true still protect these inside the project.
      for (const file of [dotKilo, agents]) {
        expect(verdict(file, tmp.path)).toMatchObject({ candidate: true, external: false, protect: true })
        expect(verdict(file, tmp.path, off, on)).toMatchObject({ candidate: true, external: false, protect: true })
        expect(verdict(file, tmp.path, on, off)).toMatchObject({ candidate: true, external: false, protect: false })
      }
    } finally {
      await fs.rm(dotKilo, { force: true })
      await fs.rm(agents, { force: true })
    }
  })

  test("protects a plain project file that symlinks to a config path", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".kilo", "kilo.json"), "{}")
    const alias = path.join(tmp.path, "settings.json")
    await fs.symlink(path.join(tmp.path, ".kilo", "kilo.json"), alias, "file")
    try {
      expect(verdict(alias, tmp.path)).toMatchObject({ candidate: true, external: false, protect: true })
      expect(verdict(alias, tmp.path, undefined, { require_approval_for_config_edits: false })).toMatchObject({
        candidate: true,
        external: false,
        protect: false,
      })
    } finally {
      await fs.rm(alias, { force: true })
    }
  })

  test("keeps protecting a config parent symlink with a nonexistent leaf", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "sub"), { recursive: true })
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const parentLink = path.join(tmp.path, ".kilo", "link")
    await fs.symlink(path.join(tmp.path, "sub"), parentLink, "dir")
    try {
      // Lexical path is protected; canonical location is an ordinary project dir with no file yet.
      expect(
        verdict(path.join(parentLink, "nested", "kilo.json"), tmp.path, undefined, {
          require_approval_for_config_edits: false,
        }),
      ).toMatchObject({ candidate: true, external: false, protect: false })
    } finally {
      await fs.rm(parentLink, { recursive: true, force: true })
    }
  })

  test("resolves a dangling in-project symlink to a missing global config target", async () => {
    await using tmp = await tmpdir()
    const prev = Global.Path.config
    const root = path.join(tmp.path, "global")
    await fs.mkdir(root, { recursive: true })
    ;(Global.Path as { config: string }).config = root
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const symlink = path.join(tmp.path, ".kilo", "kilo.json")
    await fs.symlink(path.join(root, "opencode.jsonc"), symlink, "file")
    const on = { require_approval_for_config_edits: true }
    const off = { require_approval_for_config_edits: false }
    try {
      // The dangling link escapes to a global config dir: global policy wins, not the project opt-out.
      expect(verdict(symlink, tmp.path, on, off)).toMatchObject({ candidate: true, external: true, protect: true })
      // Inverse: the global opt-out auto-approves the escaped target despite the project opt-in.
      expect(verdict(symlink, tmp.path, off, on)).toMatchObject({ candidate: true, external: true, protect: false })
    } finally {
      ;(Global.Path as { config: string }).config = prev
    }
  })

  test("resolves a relative symlink ancestor and dangling suffix to a missing global target", async () => {
    await using tmp = await tmpdir()
    const prev = Global.Path.config
    const root = path.join(tmp.path, "global")
    await fs.mkdir(root, { recursive: true })
    ;(Global.Path as { config: string }).config = root
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    await fs.symlink(root, path.join(tmp.path, ".kilo", "alias"), link)
    const symlink = path.join(tmp.path, ".kilo", "link")
    await fs.symlink(path.join("alias", "opencode.jsonc"), symlink, "file")
    const on = { require_approval_for_config_edits: true }
    const off = { require_approval_for_config_edits: false }
    try {
      expect(verdict(symlink, tmp.path, on, off)).toMatchObject({ candidate: true, external: true, protect: true })
      expect(verdict(symlink, tmp.path, off, on)).toMatchObject({ candidate: true, external: true, protect: false })
    } finally {
      ;(Global.Path as { config: string }).config = prev
    }
  })

  test("resolves a relative `..` in a link target to the physical project scope", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const symlink = path.join(tmp.path, ".kilo", "link")
    await fs.symlink(["..", "missing.json"].join("/"), symlink, "file")
    const on = { require_approval_for_config_edits: true }
    const off = { require_approval_for_config_edits: false }
    try {
      // The `..` lands inside the project, so the project policy governs it: an opt-in protects,
      // while a global opt-out must not weaken the project.
      expect(verdict(symlink, tmp.path, off, on)).toMatchObject({ candidate: true, external: false, protect: true })
      expect(verdict(symlink, tmp.path, on, off)).toMatchObject({ candidate: true, external: false, protect: false })
    } finally {
      await fs.rm(symlink, { force: true })
    }
  })

  test("resolves `..` after a symlink component to the physical out-of-project target", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    await fs.symlink(outside.path, path.join(tmp.path, "alias"), link)
    const symlink = path.join(tmp.path, ".kilo", "kilo.json")
    await fs.symlink(["..", "alias", "..", "opencode.jsonc"].join("/"), symlink, "file")
    const on = { require_approval_for_config_edits: true }
    const off = { require_approval_for_config_edits: false }
    try {
      // `alias/..` applies to the symlink's physical target, so this escapes and needs global policy.
      expect(verdict(symlink, tmp.path, on, off)).toMatchObject({ candidate: true, external: true, protect: true })
      expect(verdict(symlink, tmp.path, off, on)).toMatchObject({ candidate: true, external: true, protect: false })
    } finally {
      await fs.rm(symlink, { force: true })
    }
  })

  test("consults both policies for an unprovable symlink cycle", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const first = path.join(tmp.path, ".kilo", "a.json")
    const second = path.join(tmp.path, ".kilo", "b.json")
    await fs.symlink(second, first, "file")
    await fs.symlink(first, second, "file")
    const on = { require_approval_for_config_edits: true }
    const off = { require_approval_for_config_edits: false }
    try {
      // The scope is unprovable: an inside OR a global opt-out alone must not weaken it.
      expect(verdict(first, tmp.path, off, on)).toMatchObject({ candidate: true, external: false, protect: true })
      expect(verdict(first, tmp.path, on, off)).toMatchObject({ candidate: true, external: false, protect: true })
      expect(verdict(first, tmp.path, off, off)).toMatchObject({ candidate: true, external: false, protect: false })
    } finally {
      await fs.rm(first, { force: true })
      await fs.rm(second, { force: true })
    }
  })

  test("bounds long relative symlink chains and treats overflow as unproven", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const count = 45
    for (let i = 0; i < count; i++) {
      const target = i === count - 1 ? "missing.json" : `link${i + 1}.json`
      await fs.symlink(target, path.join(tmp.path, ".kilo", `link${i}.json`), "file")
    }
    const on = { require_approval_for_config_edits: true }
    const off = { require_approval_for_config_edits: false }
    try {
      const head = path.join(tmp.path, ".kilo", "link0.json")
      // Exceeding the hop bound is unprovable, so either active policy still protects.
      expect(verdict(head, tmp.path, off, on)).toMatchObject({ candidate: true, external: false, protect: true })
      expect(verdict(head, tmp.path, off, off)).toMatchObject({ candidate: true, external: false, protect: false })
    } finally {
      await fs.rm(path.join(tmp.path, ".kilo"), { recursive: true, force: true })
    }
  })

  test("keeps a dangling symlink whose missing destination is inside the project under project policy", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const symlink = path.join(tmp.path, ".kilo", "kilo.json")
    await fs.symlink(path.join(tmp.path, "missing.json"), symlink, "file")
    const off = { require_approval_for_config_edits: false }
    const on = { require_approval_for_config_edits: true }
    try {
      expect(verdict(symlink, tmp.path, on, off)).toMatchObject({ candidate: true, external: false, protect: false })
      expect(verdict(symlink, tmp.path, off, on)).toMatchObject({ candidate: true, external: false, protect: true })
    } finally {
      await fs.rm(symlink, { force: true })
    }
  })

  test("resolves a dangling symlink outside the project to the global policy", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    await fs.mkdir(path.join(tmp.path, ".kilo"), { recursive: true })
    const symlink = path.join(tmp.path, ".kilo", "kilo.json")
    await fs.symlink(path.join(outside.path, "missing.json"), symlink, "file")
    const off = { require_approval_for_config_edits: false }
    const on = { require_approval_for_config_edits: true }
    try {
      expect(verdict(symlink, tmp.path, on, off)).toMatchObject({ candidate: true, external: true, protect: true })
      expect(verdict(symlink, tmp.path, off, on)).toMatchObject({ candidate: true, external: true, protect: false })
    } finally {
      await fs.rm(symlink, { force: true })
    }
  })

  test("keeps a nonexistent symlink-free config leaf scoped to the project", async () => {
    await using tmp = await tmpdir()
    expect(
      verdict(".kilo/missing.json", tmp.path, undefined, { require_approval_for_config_edits: false }),
    ).toMatchObject({ candidate: true, external: false, protect: false })
  })
})

describe("ConfigProtection.classify", () => {
  const request = (file: string) => ({
    permission: "edit",
    patterns: [file],
    metadata: { filepath: file },
  })

  test("applies one classification through verdict exactly like evaluate", async () => {
    await using tmp = await tmpdir()
    const target = ".kilo/kilo.json"
    const classification = ConfigProtection.classify(request(target), tmp.path)
    expect(classification).toMatchObject({ candidate: true, external: false, inside: true })
    const project = { require_approval_for_config_edits: false }
    expect(ConfigProtection.verdict(classification, { project })).toEqual(
      ConfigProtection.evaluate(request(target), { root: tmp.path, project }),
    )
  })

  test("keeps an independent global-skill candidate when there are no protected targets", async () => {
    await using tmp = await tmpdir()
    const prev = Global.Path.config
    ;(Global.Path as { config: string }).config = tmp.path
    const skill = path.join(tmp.path, "skills", "classify-skill")
    await fs.mkdir(skill, { recursive: true })
    try {
      const pattern = (skill + "/*").replaceAll("\\", "/")
      const classification = ConfigProtection.classify(
        {
          permission: "external_directory",
          patterns: [pattern],
          // File-tool requests have no protected write targets, but the skill candidate stays independent.
          metadata: { filepath: path.join(skill, "SKILL.md") },
        },
        os.tmpdir(),
      )
      expect(classification.candidate).toBe(false)
      expect(classification.skill).toBe(pattern)
      expect(classification.candidate || classification.skill !== undefined).toBe(true)
      // The read is ungated but still carries the canonical skill through the verdict.
      expect(ConfigProtection.verdict(classification).skill).toBe(pattern)
      expect(ConfigProtection.skillScope(ConfigProtection.verdict(classification))).toBe(pattern)
    } finally {
      ;(Global.Path as { config: string }).config = prev
    }
  })

  test("resolves the skill candidate lazily and consistently", () => {
    const classification = ConfigProtection.classify(
      { permission: "edit", patterns: ["src/index.ts"], metadata: { filepath: "src/index.ts" } },
      os.tmpdir(),
    )
    expect(classification.candidate).toBe(false)
    expect(classification.skill).toBeUndefined()
    expect(classification.skill).toBeUndefined()
  })
})

describe("ConfigProtection.skillScope", () => {
  test("keeps the canonical skill for ungated reads but drops it for disabled edits", () => {
    const skill = "/global/skills/a/*"
    expect(ConfigProtection.skillScope({ candidate: false, protect: false, external: false, skill })).toBe(skill)
    expect(ConfigProtection.skillScope({ candidate: true, protect: true, external: true, skill })).toBe(skill)
    expect(ConfigProtection.skillScope({ candidate: true, protect: false, external: true, skill })).toBeUndefined()
    expect(ConfigProtection.skillScope({ candidate: true, protect: false, external: false })).toBeUndefined()
  })
})
