import { describe, expect, test } from "bun:test"
import path from "node:path"
import { AgentRemove } from "../src/agent/remove"

// The path rules that decide what a `kilocode.agent` removal may delete, with no host in the way.
const project = path.resolve("/work/app")
const root = path.join(project, ".kilo2")
const global = path.resolve("/home/user/.config/kilo")

describe("agent files", () => {
  test("the id is the file path under its discovery directory", () => {
    expect(AgentRemove.documentID(root, path.join(root, "agents", "demo.md"))).toBe("demo")
    expect(AgentRemove.documentID(root, path.join(root, "agents", "nested", "deep.md"))).toBe("nested/deep")
    expect(AgentRemove.documentID(root, path.join(root, "mode", "reviewer.md"))).toBe("reviewer")
  })

  test("a file is an agent only at the depth the config plugin scans", () => {
    expect(AgentRemove.isAgentFile(root, path.join(root, "agents", "demo.md"))).toBe(true)
    expect(AgentRemove.isAgentFile(root, path.join(root, "agent", "demo.md"))).toBe(true)
    expect(AgentRemove.isAgentFile(root, path.join(root, "agents", "nested", "deep.md"))).toBe(true)
    // `{mode,modes}/*.md` is one level deep, so a nested mode file is never registered.
    expect(AgentRemove.isAgentFile(root, path.join(root, "mode", "reviewer.md"))).toBe(true)
    expect(AgentRemove.isAgentFile(root, path.join(root, "modes", "nested", "deep.md"))).toBe(false)
    expect(AgentRemove.isAgentFile(root, path.join(root, "skills", "demo.md"))).toBe(false)
    expect(AgentRemove.isAgentFile(root, path.join(root, "agents.md"))).toBe(false)
    expect(AgentRemove.isAgentFile(root, path.join(root, "agents", "demo.txt"))).toBe(false)
    expect(AgentRemove.isAgentFile(root, path.join(root, "..", "other", "agents", "x.md"))).toBe(false)
  })
})

describe("roots", () => {
  const candidate = (value: string, resolved = value) => ({ root: value, resolved })

  test("the project directory is project-scoped and the global config directory is global", () => {
    expect(AgentRemove.roots([candidate(root), candidate(global)], project, global)).toEqual([
      { root, scope: "project" },
      { root: global, scope: "global" },
    ])
  })

  test("a directory that resolves outside the project and the global config is not a root", () => {
    // A project `.kilo2` symlinked to the filesystem root, and one pointing at another user's home.
    expect(AgentRemove.roots([candidate(root, "/")], project, global)).toEqual([])
    expect(AgentRemove.roots([candidate(root, "/tmp/elsewhere")], project, global)).toEqual([])
  })

  test("a symlink that still resolves inside the project stays a project root", () => {
    const link = path.join(project, ".kilo2")
    const target = path.join(project, "config")
    expect(AgentRemove.roots([candidate(link, target)], project, global)).toEqual([
      { root: link, scope: "project" },
    ])
  })

  test("only directories the config service reports are roots", () => {
    expect(AgentRemove.roots([], project, global)).toEqual([])
  })
})

describe("agents", () => {
  test("files outside the discovery depth are not listed", () => {
    const known = [{ root, scope: "project" as const }]
    const files = [
      path.join(root, "agents", "demo.md"),
      path.join(root, "modes", "nested", "deep.md"),
      path.join(root, "skills", "demo.md"),
    ]
    expect(AgentRemove.agents(files, known)).toEqual([
      { name: "demo", path: path.join(root, "agents", "demo.md"), scope: "project" },
    ])
  })
})

describe("targets", () => {
  const demo = path.join(root, "agents", "demo.md")
  const same = path.join(global, "agents", "demo.md")
  const known = [
    { name: "demo", path: demo, scope: "project" as const },
    { name: "demo", path: same, scope: "global" as const },
    { name: "writer", path: path.join(root, "agents", "writer.md"), scope: "project" as const },
  ]
  const registered = ["demo", "writer", "plan"]

  test("an omitted scope deletes every editable definition", () => {
    expect(AgentRemove.target({ name: "demo", known, registered })).toEqual({
      _tag: "target",
      files: [demo, same],
    })
  })

  test("a scope narrows the removal to that root", () => {
    expect(AgentRemove.target({ name: "demo", known, registered, scope: "global" })).toEqual({
      _tag: "target",
      files: [same],
    })
    expect(AgentRemove.target({ name: "writer", known, registered, scope: "global" })).toEqual({
      _tag: "failure",
      reason: "not_found",
    })
  })

  test("a registered agent with no file is refused as not removable", () => {
    expect(AgentRemove.target({ name: "plan", known, registered })).toEqual({
      _tag: "failure",
      reason: "not_removable",
    })
  })

  test("an unknown name is not found", () => {
    expect(AgentRemove.target({ name: "ghost", known, registered })).toEqual({
      _tag: "failure",
      reason: "not_found",
    })
  })
})
