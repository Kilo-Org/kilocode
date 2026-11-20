import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { ConfigMarkdown } from "@opencode/core/config/markdown"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { applyConfig, planConfig } from "../src/migration/config"

function put(root: string, name: string, text: string, mode = 0o600) {
  const file = path.join(root, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, { mode })
  return file
}

function snapshot(root: string) {
  return [".", ...fs.readdirSync(root, { recursive: true, encoding: "utf8" }).sort()].map((relative) => {
    const file = path.join(root, relative)
    const stat = fs.lstatSync(file, { bigint: true })
    return [relative, stat.mode, stat.mtimeNs, stat.isFile() ? fs.readFileSync(file, "utf8") : undefined]
  })
}

test("plan is read-only; apply keeps models, Markdown discovery, skill assets and both original profiles", async () => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "kilo")
  const preview = path.join(root.path, "kilo2")
  const stableDoc = put(stable, "kilo.json", '{"model":"kilo/stable", "instructions":["rules/*.md"]}')
  const jsonc = '{// fixture\n "providers":{"synthetic":{"models":{"demo":{}}}},\n}'
  put(preview, "kilo2.jsonc", jsonc)
  const workflow = "# Inspect changes\n\nReview this diff: $ARGUMENTS.\n"
  put(stable, "workflows/inspect.md", workflow)
  put(stable, "mode/explain.md", "Explain the code.")
  put(preview, "agents/team/draft.md", "---\nmode: subagent\n---\nDraft a note.")
  put(preview, "skills/trace/SKILL.md", "---\ndescription: Trace a change\n---\nUse the bundled script.")
  put(preview, "skills/trace/bin/check.sh", "#!/bin/sh\nexit 0\n", 0o700)
  put(preview, "commands/test.md", "Run the tests.")
  put(preview, "cli.json", '{"theme":{"name":"kilo"}}')
  put(preview, "AGENTS.md", "Use the fixture.")
  put(preview, "auth.json", "PRIVATE-FIXTURE")
  put(preview, "skills/trace/.env", "SECRET=PRIVATE-FIXTURE")
  const before = snapshot(root.path)
  const source = snapshot(preview)
  const mtime = fs.statSync(stableDoc, { bigint: true }).mtimeNs
  const plan = planConfig(stable, preview)
  expect(plan.conflicts).toEqual([])
  expect(snapshot(root.path)).toEqual(before)
  expect(plan.skipped.join("\n")).toContain("auth.json")
  expect(JSON.stringify(plan)).not.toContain("PRIVATE-FIXTURE")

  applyConfig(plan)
  expect(fs.readFileSync(path.join(stable, "kilo.jsonc"), "utf8")).toBe(jsonc)
  expect(fs.statSync(stableDoc, { bigint: true }).mtimeNs).toBe(mtime)
  expect(fs.readFileSync(path.join(stable, "workflows/inspect.md"), "utf8")).toBe(workflow)
  const command = ConfigMarkdown.parse(fs.readFileSync(path.join(stable, "command/inspect.md"), "utf8"))
  expect(command.data).toEqual({ description: "Review this diff: $ARGUMENTS." })
  expect(command.content.trim()).toBe(workflow.trim())
  for (const name of [
    "commands/test.md",
    "agents/team/draft.md",
    "skills/trace/SKILL.md",
    "skills/trace/bin/check.sh",
    "AGENTS.md",
    "cli.json",
  ]) {
    expect(fs.readFileSync(path.join(stable, name))).toEqual(fs.readFileSync(path.join(preview, name)))
  }
  expect(fs.existsSync(path.join(stable, "auth.json"))).toBe(false)
  expect(fs.existsSync(path.join(stable, "skills/trace/.env"))).toBe(false)
  expect(snapshot(preview)).toEqual(source)
  const applied = snapshot(stable)
  applyConfig(plan)
  applyConfig(planConfig(stable, preview))
  expect(snapshot(stable)).toEqual(applied)
})

test("both extension layers of a single profile retain their original precedence", async () => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "missing/config/kilo")
  const preview = path.join(root.path, "kilo2")
  put(preview, "kilo2.json", '{"model":"kilo/low"}')
  put(preview, "kilo2.jsonc", '{"model":"kilo/high"}')
  const plan = planConfig(stable, preview)
  expect(plan.conflicts).toEqual([])
  expect(fs.existsSync(stable)).toBe(false)
  applyConfig(plan)
  applyConfig(plan)
  expect(fs.readFileSync(path.join(stable, "kilo.jsonc"), "utf8")).toContain("kilo/high")
})

test.each([
  ["kilo.json", '{"model":"kilo/one"}', "kilo2.json", '{"model":"kilo/two"}', "Different files"],
  ["kilo.jsonc", '{"provider":{"p":{}}}', "kilo2.json", '{"providers":{"p":{}}}', "precedence"],
  ["kilo2.json", '{"model":"kilo/one"}', "kilo.json", '{"model":"kilo/two"}', "Different files"],
  ["modes/check.md", "Primary", "agent/check.md", "Subagent", "agent:check"],
  ["commands/test.md", "Old command", "workflows/test.md", "Other workflow", "command:test"],
  ["skill/group/trace/SKILL.md", "One", "skills/other/trace/SKILL.md", "Two", "skill:trace"],
  ["kilo.json", '{"command":{"x":{"template":"One"}}}', "workflows/x.md", "Two", "command:x"],
])("detects conflicts before any additive writes: %s vs %s", async (existing, oldText, incoming, newText, issue) => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "kilo")
  const preview = path.join(root.path, "kilo2")
  put(stable, existing, oldText)
  put(preview, incoming, newText)
  put(preview, "AGENTS.md", "Must not be copied")
  const before = snapshot(root.path)
  const plan = planConfig(stable, preview)
  expect(plan.conflicts.join("\n")).toContain(issue)
  expect(() => applyConfig(plan)).toThrow()
  expect(snapshot(root.path)).toEqual(before)
})

test.each([
  ["stable", "kilo.json", '{"plugin":["legacy-api"]}', "compatibility"],
  ["stable", "plugins/legacy.ts", "import './legacy'", "compatibility"],
  ["preview", "kilo2.json", '{"providers":{"p":{"settings":{"apiKey":"PRIVATE-FIXTURE"}}}}', "credential"],
  ["preview", "kilo2.jsonc", '{"model":"{file:./selector}"}', "Relative path"],
  ["preview", "kilo2.jsonc", '{"instructions":["notes/*.md"]}', "Relative path"],
  ["stable", "workflows/read.md", "Read {file:./notes}", "substitution"],
  ["stable", "modes/name.md", "---\nname: other\n---\nLegacy primary", "name and discovery path"],
  ["stable", "workflows/read.md", "Read [the guide](guide.md)", "Relative Markdown link"],
  ["stable", "kilo2.json", '{"provider":{"p":{"options":{"apiKey":"PRIVATE-FIXTURE"}}}}', "credential"],
  ["stable", "kilo.json", '{"provider":{"p":{"blacklist":["model1"]}}}', "Runtime would ignore"],
  ["stable", "skills/directory/SKILL.md", "---\nname: different-legacy-id\n---\nSkill", "name and discovery directory"],
  ["preview", "skills/trace/metadata.json", '{"refresh":"PRIVATE-FIXTURE"}', "Manual"],
  ["preview", "kilo2.json", "{oops}", "Invalid JSON"],
  ["preview", "kilo2.json", '{"model":"a/b","model":"c/d"}', "Duplicate"],
  ["stable", "settings/custom_modes.yaml", "customModes: []", "Manual"],
])("requires manual review for %s %s without revealing values", async (dir, name, text, issue) => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "stable")
  const preview = path.join(root.path, "preview")
  put(path.join(root.path, dir), name, text)
  put(preview, "AGENTS.md", "Unrelated")
  const plan = planConfig(stable, preview)
  expect(plan.conflicts.join("\n")).toContain(issue)
  expect(JSON.stringify(plan)).not.toContain("PRIVATE-FIXTURE")
  expect(() => applyConfig(plan)).toThrow()
  expect(fs.existsSync(path.join(stable, "AGENTS.md"))).toBe(false)
})

test("new or changed inputs invalidate the whole plan; matching partially published output is reusable", async () => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "stable")
  const preview = path.join(root.path, "preview")
  put(preview, "AGENTS.md", "Example")
  put(preview, "agents/other.md", "Original")
  const plan = planConfig(stable, preview)
  put(preview, "agents/other.md", "Edited")
  expect(() => applyConfig(plan)).toThrow(/changed/)
  expect(fs.existsSync(stable)).toBe(false)
  put(preview, "agents/other.md", "Original")
  put(stable, "AGENTS.md", "Example")
  applyConfig(plan)
  expect(fs.readFileSync(path.join(stable, "agents/other.md"), "utf8")).toBe("Original")
})

test("a substituted source or target directory junction is never traversed", async () => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "stable")
  const preview = path.join(root.path, "preview")
  const outside = path.join(root.path, "outside")
  put(preview, "skills/trace/SKILL.md", "Example")
  put(outside, "SKILL.md", "PRIVATE-FIXTURE")
  const before = snapshot(outside)
  const plan = planConfig(stable, preview)
  fs.mkdirSync(stable)
  fs.symlinkSync(outside, path.join(stable, "skills"), "junction")
  expect(planConfig(stable, preview).conflicts.join("\n")).toMatch(/link/i)
  expect(() => applyConfig(plan)).toThrow(/link/i)
  fs.symlinkSync(outside, path.join(preview, "skills", "other"), "junction")
  const second = planConfig(path.join(root.path, "other"), preview)
  expect(second.conflicts.join("\n")).toMatch(/link/i)
  expect(second.files.some((file) => file.source.startsWith(outside))).toBe(false)
  expect(snapshot(outside)).toEqual(before)
  const alias = path.join(root.path, "alias")
  fs.symlinkSync(root.path, alias, "junction")
  expect(planConfig(path.join(alias, "new"), preview).conflicts.join("\n")).toMatch(/link/i)
})
