import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { ConfigMarkdown } from "@opencode/core/config/markdown"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { createModelPreferenceRepository } from "../../tui/src/model-preference"
import { applyConfig, planConfig } from "../src/migration/config"
import { planExtra } from "../src/migration/extra-state"
import { assertProjectConfig, assertProjectDirectories } from "../src/migration/project-config"

function roots(root: string) {
  return {
    home: path.join(root, "home"),
    stateBase: path.join(root, "xdg-state"),
    legacyState: path.join(root, "xdg-state/kilo"),
    v1State: path.join(root, "xdg-state/v1-fallback"),
    configBase: path.join(root, "xdg-config"),
    legacyConfig: path.join(root, "custom-stable-config"),
    legacyDefaultConfig: path.join(root, "custom-preview-config"),
  }
}

function put(dir: string, name: string, text: string) {
  const file = path.join(dir, name)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, text, { mode: 0o644 })
  return file
}

function image(root: string) {
  return [".", ...fs.readdirSync(root, { recursive: true, encoding: "utf8" }).sort()].map((rel) => {
    const file = path.join(root, rel)
    const stat = fs.lstatSync(file, { bigint: true })
    return [rel, stat.mode, stat.ino, stat.mtimeNs, stat.isFile() ? fs.readFileSync(file, "utf8") : undefined]
  })
}

const editor = "Code/User/globalStorage/kilocode.kilo-code"
const skill = "---\nname: trace\ndescription: Trace one change\n---\nFollow the fixture.\n"
const workflow = "# Review changes\n\nInspect this diff: $ARGUMENTS\n"
const model = { providerID: "synthetic", modelID: "one" }
const prefs =
  JSON.stringify(
    {
      recent: [model],
      favorite: [model],
      variant: { "synthetic/one": "low" },
      model: { build: model },
      futureField: 3,
    },
    null,
    2,
  ) + "\n"

test("opening HOME does not block a global workflow handled by the resource planner", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  fs.mkdirSync(path.join(opts.home, ".git"), { recursive: true })
  put(opts.home, ".kilocode/workflows/review.md", workflow)
  assertProjectConfig([opts.home], opts.home)
  const alias = path.join(tmp.path, "home-link")
  fs.symlinkSync(opts.home, alias, "junction")
  assertProjectDirectories([alias], opts.home)
  assertProjectDirectories([opts.home], alias)
  planExtra(opts).apply()
  expect(fs.readFileSync(path.join(opts.legacyConfig, "command/review.md"), "utf8")).toContain("Inspect this diff")
})

test("root-level single-file skills migrate cleanly, refuse bad frontmatter, and detect directory collisions", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  const single = put(opts.home, ".kilocode/skills/trace.md", skill)
  const plan = planExtra(opts)
  expect(plan.conflicts).toEqual([])
  plan.apply()
  expect(fs.readFileSync(path.join(opts.legacyConfig, "skills/trace.md"), "utf8")).toBe(skill)

  const dup = put(opts.home, ".kilo/skills/trace/SKILL.md", skill)
  expect(planExtra(opts).conflicts.join("\n")).toContain(dup)
  fs.rmSync(path.dirname(dup), { recursive: true })

  fs.writeFileSync(single, "---\nname: wrong\n---\nMismatch\n")
  expect(planExtra(opts).conflicts.join("\n")).toContain(single)
})

test("explicit config inline commands conflict with migrated home workflows", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  put(opts.home, ".kilocode/workflows/review.md", workflow)
  const explicit = put(tmp.path, "explicit.json", JSON.stringify({ commands: { review: { template: "Inline" } } }))
  expect(planExtra({ ...opts, explicitConfigFile: explicit }).conflicts.join("\n")).toContain(explicit)
})

test("preview model preferences are published privately and load through the TUI reader; repeated apply changes nothing", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  const source = put(opts.stateBase, "v1-fallback/model.json", prefs)
  put(opts.stateBase, "kilo/state.json", "Not model preferences")
  const target = path.join(opts.stateBase, "kilo", "model.json")
  const before = image(tmp.path)
  const plan = planExtra(opts)
  expect(plan.conflicts).toEqual([])
  expect(image(tmp.path)).toEqual(before)
  plan.apply()
  expect(fs.readFileSync(source, "utf8")).toBe(prefs)
  expect(fs.readFileSync(target, "utf8")).toBe(prefs)
  expect(fs.statSync(target).ino).not.toBe(fs.statSync(source).ino)
  if (process.platform !== "win32") expect(fs.statSync(target).mode & 0o777).toBe(0o600)
  expect(await createModelPreferenceRepository(target).load()).toEqual({
    recent: [model],
    favorite: [model],
    variant: { "synthetic/one": "low" },
  })
  const applied = image(tmp.path)
  plan.apply()
  planExtra(opts).apply()
  expect(image(tmp.path)).toEqual(applied)
})

test("absent or stable-only preferences are never initialized, rewritten or chmodded", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  const plan = planExtra(opts)
  expect(plan.conflicts).toEqual([])
  plan.apply()
  expect(fs.readdirSync(tmp.path)).toEqual([])
  put(opts.stateBase, "kilo/model.json", prefs)
  const before = image(tmp.path)
  planExtra(opts).apply()
  expect(image(tmp.path)).toEqual(before)
})

test("divergent model documents block before any addition without exposing their contents", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  const stable = put(opts.stateBase, "kilo/model.json", prefs)
  const preview = put(opts.stateBase, "v1-fallback/model.json", '{"fixture":"PRIVATE-VALUE"}')
  put(opts.home, ".kilocode/workflows/example.md", workflow)
  const before = image(tmp.path)
  const plan = planExtra(opts)
  expect(plan.conflicts.join()).toContain(stable)
  expect(plan.conflicts.join()).toContain(preview)
  expect(JSON.stringify(plan)).not.toContain("PRIVATE-VALUE")
  expect(plan.apply).toThrow()
  expect(image(tmp.path)).toEqual(before)
})

test.each([
  ["home", ".kilo"],
  ["home", ".kilocode"],
  ["home", ".config/" + editor],
  ["configBase", editor],
  ["home", "Library/Application Support/" + editor],
  ["home", "AppData/Roaming/" + editor],
] as const)("migrates only active resource files from %s/%s", async (which, relative) => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  const dir = path.join(opts[which], relative)
  put(dir, "workflows/review.md", workflow)
  put(dir, "skills/trace/SKILL.md", skill)
  put(dir, "workflows/archive/old.md", "Inactive")
  put(dir, "skills/unrelated/cache.json", "PRIVATE-FIXTURE")
  put(dir, "settings/mcp_settings.json", "PRIVATE-FIXTURE")
  put(dir, "history/archive.json", "PRIVATE-FIXTURE")
  const before = image(dir)
  const plan = planExtra(opts)
  expect(plan.conflicts).toEqual([])
  expect(fs.existsSync(opts.legacyConfig)).toBe(false)
  plan.apply()
  const command = ConfigMarkdown.parse(fs.readFileSync(path.join(opts.legacyConfig, "command/review.md"), "utf8"))
  expect(command.data).toEqual({ description: "Inspect this diff: $ARGUMENTS" })
  expect(command.content.trim()).toBe(workflow.trim())
  expect(fs.readFileSync(path.join(opts.legacyConfig, "skills/trace/SKILL.md"), "utf8")).toBe(skill)
  expect(fs.readdirSync(opts.legacyConfig).sort()).toEqual(["command", "skills"])
  expect(fs.readdirSync(path.join(opts.legacyConfig, "skills"))).toEqual(["trace"])
  if (process.platform !== "win32") expect(fs.statSync(opts.legacyConfig).mode & 0o777).toBe(0o700)
  expect(image(dir)).toEqual(before)
  const applied = image(opts.legacyConfig)
  plan.apply()
  expect(image(opts.legacyConfig)).toEqual(applied)
})

test("enumerates actual custom mode files without blocking empty or unrelated settings", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  const files = [
    ".kilocodemodes",
    `Library/Application Support/${editor}/settings/custom_modes.yaml`,
    ".kilocode/cli/global/settings/custom_modes.yaml",
  ]
  for (const file of files) put(opts.home, file, "customModes: []")
  expect(planExtra(opts).conflicts).toEqual([])
  for (const file of files) put(opts.home, file, "customModes:\n  - slug: custom\n    roleDefinition: PRIVATE-VALUE\n")
  put(opts.home, ".kilo/modes/custom.md", "PRIVATE-VALUE")
  put(opts.home, ".kilo/tmp/ignore.db", "PRIVATE-VALUE")
  const before = image(tmp.path)
  const plan = planExtra(opts)
  const errors = plan.conflicts.join("\n")
  expect(plan.conflicts).toHaveLength(4)
  for (const file of [...files, ".kilo/modes/custom.md"]) expect(errors).toContain(path.join(opts.home, file))
  expect(errors).not.toContain("PRIVATE-VALUE")
  expect(errors).not.toContain("ignore.db")
  expect(plan.apply).toThrow()
  expect(image(tmp.path)).toEqual(before)
})

test("config reconciliation may publish matching preview definitions before applying extra resources", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  put(opts.home, ".kilocode/workflows/review.md", workflow)
  put(opts.legacyDefaultConfig, "workflows/review.md", workflow)
  put(opts.home, ".kilo/skill/trace/SKILL.md", skill)
  put(opts.legacyDefaultConfig, "skills/trace/SKILL.md", skill)
  put(opts.stateBase, "v1-fallback/model.json", prefs)
  const extra = planExtra(opts)
  expect(extra.conflicts).toEqual([])
  applyConfig(planConfig(opts.legacyConfig, opts.legacyDefaultConfig))
  const config = image(opts.legacyConfig)
  extra.apply()
  expect(image(opts.legacyConfig)).toEqual(config)
  expect(fs.readFileSync(path.join(opts.stateBase, "kilo/model.json"), "utf8")).toBe(prefs)
})

test.each([
  ["legacyConfig", "commands/review.md", "Other template"],
  ["legacyDefaultConfig", "workflows/REVIEW.md", "Other template"],
  ["legacyDefaultConfig", "kilo.jsonc", '{ "command": {"review":{"template":"Other"}}}'],
  ["legacyConfig", "skill/other/trace/SKILL.md", skill],
  ["legacyDefaultConfig", "skills/trace/lib.sh", "Other asset"],
  ["legacyDefaultConfig", "skills/SKILL.md", "Root skill hides nested manifests"],
  ["home", ".kilocode/workflows/review.md", "Other template"],
  ["home", ".kilo/skills/trace/rules.md", "Bundle asset"],
  ["home", ".kilocode/workflows/read.md", "Read {file:./secret}"],
  ["stateBase", "v1-fallback/model.json", "[not model preferences]"],
] as const)("conflicting or unsafe %s/%s prevents all writes", async (which, rel, text) => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  put(opts.home, ".kilo/workflows/review.md", workflow)
  put(opts.home, ".kilo/skills/trace/SKILL.md", skill)
  put(opts.stateBase, "v1-fallback/model.json", prefs)
  const issue = put(opts[which], rel, text)
  const before = image(tmp.path)
  const plan = planExtra(opts)
  expect(plan.conflicts.join()).toContain(rel.endsWith("rules.md") ? path.dirname(issue) : issue)
  expect(plan.apply).toThrow()
  expect(image(tmp.path)).toEqual(before)
})

test("new destinations, changed input and substituted parent links invalidate the entire plan", async () => {
  await using tmp = await tmpdir()
  const opts = roots(tmp.path)
  put(opts.home, ".kilo/workflows/review.md", workflow)
  put(opts.stateBase, "v1-fallback/model.json", prefs)
  const plan = planExtra(opts)
  put(opts.stateBase, "v1-fallback/model.json", "{}")
  expect(plan.apply).toThrow(/changed/)
  expect(fs.existsSync(path.join(opts.stateBase, "kilo"))).toBe(false)
  put(opts.stateBase, "v1-fallback/model.json", prefs)
  const collision = put(opts.legacyConfig, "command/review.md", "Manual edit")
  expect(plan.apply).toThrow(/conflict/)
  expect(fs.readFileSync(collision, "utf8")).toBe("Manual edit")
  expect(fs.existsSync(path.join(opts.stateBase, "kilo"))).toBe(false)
  fs.rmSync(opts.legacyConfig, { recursive: true })
  const outside = path.join(tmp.path, "outside")
  put(outside, "decoy", "PRIVATE-FIXTURE")
  const untouched = image(outside)
  fs.symlinkSync(outside, opts.legacyConfig, "junction")
  expect(plan.apply).toThrow(/link/)
  fs.unlinkSync(opts.legacyConfig)
  fs.rmSync(path.join(opts.stateBase, "v1-fallback"), { recursive: true })
  fs.symlinkSync(outside, path.join(opts.stateBase, "v1-fallback"), "junction")
  expect(planExtra(opts).conflicts.join()).toContain("link")
  expect(image(outside)).toEqual(untouched)
})
