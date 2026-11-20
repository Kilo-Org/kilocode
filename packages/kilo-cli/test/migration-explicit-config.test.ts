import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { applyConfig, planConfig } from "../src/migration/config"
import { applyCutover, migrationStatus } from "../src/migration/cutover"
import { explicitConfig, preflight } from "../src/migration/preflight"

test("two explicit files with different model and shell permissions block preflight and cutover before acquiring ownership", async () => {
  await using root = await tmpdir()
  const env = {
    XDG_DATA_HOME: path.join(root.path, "data"),
    XDG_CONFIG_HOME: path.join(root.path, "config"),
    HOME: root.path,
    USERPROFILE: root.path,
    KILO_CONFIG: path.join(root.path, "stable-overrides.jsonc"),
    KILO2_CONFIG: path.join(root.path, "preview-overrides.json"),
  }
  const v1 = '{"model":"kilo/legacy","permission":{"bash":"deny"}}'
  const preview = '{"model":"kilo/preview","permissions":[{"action":"shell","effect":"allow","resource":"*"}]}'
  writeFileSync(env.KILO_CONFIG, v1)
  writeFileSync(env.KILO2_CONFIG, preview)
  const source = path.join(env.XDG_DATA_HOME, "kilo", "kilo.db")
  mkdirSync(path.dirname(source), { recursive: true })
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
  }
  const before = readFileSync(source)
  const plan = preflight(env)
  const both = `${env.KILO_CONFIG} and ${env.KILO2_CONFIG}`
  expect(() => migrationStatus(plan)).toThrow(both)
  await expect(applyCutover(plan, () => {})).rejects.toThrow(both)
  expect(readFileSync(source)).toEqual(before)
  expect(existsSync(plan.backup)).toBe(false)
  expect(existsSync(path.join(env.XDG_DATA_HOME, "kilo2"))).toBe(false)
  expect(readFileSync(env.KILO_CONFIG, "utf8")).toBe(v1)
  expect(readFileSync(env.KILO2_CONFIG, "utf8")).toBe(preview)
})

test("one explicit JSONC document keeps its path, is validated, and cannot change mid-conversion", async () => {
  await using root = await tmpdir()
  const stable = path.join(root.path, "kilo")
  const preview = path.join(root.path, "kilo2")
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
    { KILO2_CONFIG: file },
    { OPENCODE_CONFIG: file },
    { KILO_CONFIG: file, KILO2_CONFIG: file },
  ]) {
    const selected = explicitConfig(
      preflight(
        { HOME: root.path, USERPROFILE: root.path, XDG_DATA_HOME: root.path, KILO_DB: source, ...overrides },
        root.path,
      ),
    )
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
