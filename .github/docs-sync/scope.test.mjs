// kilocode_change - new file

/**
 * Scope guard for the docs-sync change.
 *
 * The `bun install` run behind this change pruned
 * `patches/ghostty-web@0.3.0.patch` and let bun rewrite the lockfile's
 * `trustedDependencies` and `patchedDependencies` lists in its own order. Both
 * are the package manager's output and are left exactly as `bun install` wrote
 * them — restoring either by hand would only be pruned and re-sorted again.
 *
 * This guard records why the patch is genuinely orphaned, and fails if the
 * docs-sync surface files go missing.
 *
 * Run: node .github/docs-sync/scope.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

test("the ghostty-web patch is orphaned, so bun install prunes it", () => {
  const root = JSON.parse(read("package.json"))
  const patched = Object.keys(root.patchedDependencies ?? {})
  assert.ok(
    !patched.some((key) => key.startsWith("ghostty-web")),
    `nothing patches ghostty-web, so patches/ghostty-web@0.3.0.patch is orphaned and bun install prunes it; patchedDependencies: ${patched.join(", ")}`,
  )
  // The only consumer is on 0.4.0, so nothing looks for the 0.3.0 patch.
  const consumer = JSON.parse(read("packages/kilo-console/package.json"))
  const version = consumer.dependencies?.["ghostty-web"] ?? consumer.devDependencies?.["ghostty-web"] ?? ""
  assert.match(version, /^0\.4\./, "the only ghostty-web consumer must be on 0.4.x")
})

test("the docs-sync surface files are still present", () => {
  for (const file of ["surfaces.json", "surfaces.mjs", "reviewers.mjs", "prepare-branch.mjs", "upsert-pr.mjs"]) {
    assert.ok(fs.existsSync(path.join(ROOT, ".github/docs-sync", file)), `.github/docs-sync/${file} must exist`)
  }
  const map = JSON.parse(read(".github/docs-sync/surfaces.json"))
  const names = (map.surfaces ?? []).map((s) => s.name)
  for (const name of ["cli", "vscode", "jetbrains", "gateway", "web"]) {
    assert.ok(names.includes(name), `surface map must still enumerate ${name}`)
  }
  assert.equal(map.other?.name, "other")
})
