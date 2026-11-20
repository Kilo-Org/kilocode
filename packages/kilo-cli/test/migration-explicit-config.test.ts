import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { applyConfig, planConfig } from "../src/migration/config"
import { preflight } from "../src/migration/preflight"

test("one explicit JSONC document keeps its path, is validated, and cannot change mid-conversion", async () => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "kilo")
  const preview = path.join(root.path, "other")
  mkdirSync(stable)
  const file = path.join(stable, "custom.jsonc")
  const original = '{ // keep permissions and model\n "model":"kilo/fixture", "permission":{"bash":"deny"} }'
  writeFileSync(file, original)
  const source = path.join(root.path, "kilo.db")
  {
    using db = new Database(source)
    db.run("CREATE TABLE session(id TEXT PRIMARY KEY)")
  }
  for (const overrides of [
    { KILO_CONFIG: file },
    { OPENCODE_CONFIG: file },
    { KILO_CONFIG: file, OPENCODE_CONFIG: path.join(root.path, "ignored.json") },
  ]) {
    const selected = preflight(
      { HOME: root.path, USERPROFILE: root.path, XDG_DATA_HOME: root.path, KILO_DB: source, ...overrides },
      root.path,
    ).legacyConfigFile
    expect(selected).toBe(file)
    const plan = planConfig(stable, preview, selected)
    expect(plan.conflicts).toEqual([])
    applyConfig(plan)
    expect(readFileSync(file, "utf8")).toBe(original)
  }
  const plan = planConfig(stable, preview, file)
  writeFileSync(file, '{"model":"kilo/changed"}')
  expect(() => applyConfig(plan)).toThrow("changed after planning")
})
