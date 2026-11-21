import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { ConfigProtection } from "../../../src/kilocode/permission/config-paths"
import { tmpdir } from "../../fixture/fixture"

describe("Kilo data protection", () => {
  const root = Global.Path.data
  const worktree = path.join(root, "worktree", "project", "checkout")

  test("protects the data root, internal files, and worktree containers", () => {
    for (const relative of [
      "",
      "auth.json",
      "storage/session.json",
      "plans",
      "plans/state.json",
      "plans/nested/plan.md",
      "worktree",
      "worktree/project",
      "worktree/project/checkout",
    ]) {
      const file = path.join(root, relative)
      expect({ file, protected: ConfigProtection.isRequest({ permission: "edit", patterns: [file] }) }).toEqual({
        file,
        protected: true,
      })
    }
    expect(ConfigProtection.isRequest({ permission: "edit", patterns: [root + "-other/file.txt"] })).toBe(false)
  })

  test("keeps config files inside data-hosted worktrees protected", () => {
    for (const relative of [
      "kilo.json",
      "AGENTS.md",
      ".kilo/agent/custom.md",
      "packages/app/.kilocode/command/custom.md",
    ]) {
      expect(ConfigProtection.isRequest({ permission: "edit", patterns: [path.join(worktree, relative)] })).toBe(true)
    }
    expect(ConfigProtection.isAbsolute(path.join(worktree, ".kilo", "agent", "custom.md"))).toBe(false)
  })

  test("checks absolute file metadata and every patch source and destination", () => {
    const file = path.join(root, "auth.json")
    const source = path.join(worktree, "src", "index.ts")
    expect(
      ConfigProtection.isRequest({ permission: "edit", patterns: ["auth.json"], metadata: { filepath: file } }),
    ).toBe(true)
    for (const files of [[{ filePath: file }], [{ filePath: source, movePath: file }]]) {
      expect(ConfigProtection.isRequest({ permission: "edit", patterns: ["src/index.ts"], metadata: { files } })).toBe(
        true,
      )
    }
  })

  test("protects shell directory mutations, including containers and ancestors", () => {
    for (const dir of [
      root,
      path.dirname(root),
      path.parse(root).root,
      path.join(root, "plans"),
      worktree,
      path.join(worktree, "src"),
    ]) {
      expect(ConfigProtection.isRequest({ permission: "external_directory", patterns: [path.join(dir, "*")] })).toBe(
        true,
      )
    }
  })

  test("resolves aliases and rejects symlink escapes from editable data", async () => {
    await using tmp = await tmpdir()
    const previous = Global.Path.data
    const root = path.join(tmp.path, "data")
    const checkout = path.join(root, "worktree", "project", "checkout")
    const plans = path.join(root, "plans")
    const internal = path.join(root, "internal")
    const alias = path.join(tmp.path, "alias")
    const type = process.platform === "win32" ? "junction" : "dir"
    await fs.mkdir(checkout, { recursive: true })
    await fs.mkdir(plans, { recursive: true })
    await fs.mkdir(internal, { recursive: true })
    await fs.mkdir(path.join(internal, "nested"), { recursive: true })
    await fs.symlink(root, alias, type)
    await fs.symlink(internal, path.join(checkout, "link"), type)
    await fs.symlink(path.join(internal, "nested"), path.join(checkout, "traversal"), type)
    await fs.symlink(internal, path.join(root, "worktree", "project", "linked"), type)
    await fs.writeFile(path.join(internal, "state.md"), "internal state")
    await fs.symlink(path.join(internal, "state.md"), path.join(plans, "linked.md"), "file")
    await fs.symlink(path.join(internal, "new.json"), path.join(plans, "dangling.md"), "file")
    await fs.symlink(path.join(internal, "new.json"), path.join(tmp.path, "dangling.json"), "file")
    Global.Path.data = root
    try {
      for (const file of [
        path.join(alias, "auth.json"),
        path.join(checkout, "link", "new.txt"),
        path.join(root, "worktree", "project", "linked", "new.txt"),
        path.join(plans, "linked.md"),
        path.join(plans, "dangling.md"),
        path.join(tmp.path, "dangling.json"),
        `${path.join(checkout, "traversal")}${path.sep}..${path.sep}state.md`,
        `${path.join(checkout, "traversal")}${path.sep}..${path.sep}new.json`,
        path.join(plans, "..", "auth.json"),
      ]) {
        expect({ file, protected: ConfigProtection.isRequest({ permission: "edit", patterns: [file] }) }).toEqual({
          file,
          protected: true,
        })
      }
      expect(
        ConfigProtection.isRequest({
          permission: "edit",
          patterns: [path.join(alias, "worktree", "project", "checkout", "src", "new.ts")],
        }),
      ).toBe(false)
    } finally {
      Global.Path.data = previous
    }
  })

  test("data protection wins over global skill trust through symlinks", async () => {
    await using tmp = await tmpdir()
    const previous = Global.Path.config
    const config = path.join(tmp.path, "config")
    await fs.mkdir(config, { recursive: true })
    await fs.symlink(Global.Path.data, path.join(config, "skills"), process.platform === "win32" ? "junction" : "dir")
    Global.Path.config = config
    try {
      const request = { permission: "external_directory", patterns: [path.join(config, "skills", "memory", "*")] }
      expect(ConfigProtection.isRequest(request)).toBe(true)
      expect(ConfigProtection.globalSkillPattern(request)).toBeUndefined()
    } finally {
      Global.Path.config = previous
    }
  })
})
