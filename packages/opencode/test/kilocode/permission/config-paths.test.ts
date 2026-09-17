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
})
