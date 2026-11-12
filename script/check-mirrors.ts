#!/usr/bin/env bun
/**
 * Mirror drift check: fails when a Kilo-owned copy of an upstream file is out of date.
 *
 * A mirror is registered in script/upstream/mirrors.json with the upstream blob SHA last verified
 * against the pinned release and the intent of Kilo's differences. Upstream never edits Kilo-owned
 * paths, so a copied upstream change merges cleanly at its own path and the copy drifts silently.
 * This check turns that drift into a failure with the recorded intent, so a sync re-merges the
 * change and records the new SHA.
 *
 * It fails when:
 * - the pinned upstream file changed or disappeared since the recorded SHA
 * - a registered mirror is missing, or its `// kilo_mirror: <upstream path>` marker is missing or names another file
 * - a copy declares a marker that has no registry entry
 *
 * Usage:
 *   bun script/check-mirrors.ts               # HEAD against the pin
 *   bun script/check-mirrors.ts --json        # machine-readable states and errors
 *   bun script/check-mirrors.ts --pin <ref>   # another upstream commit
 *   bun script/check-mirrors.ts --registry <file>
 */

import { repoRoot } from "./upstream/utils/baseline"
import { inspect, problems, REGISTRY, status } from "./upstream/utils/mirrors"
import { pinned } from "./upstream/utils/upstream"

const argv = process.argv.slice(2)
const value = (name: string) => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const next = argv[i + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}
const known = new Set(["--pin", "--registry", "--json"])
const unknown = argv.filter((arg) => arg.startsWith("--") && !known.has(arg))
if (unknown.length > 0) {
  console.error(`check-mirrors: unknown option ${unknown.join(", ")}`)
  process.exit(1)
}

const root = await repoRoot()
const pin = value("--pin") ?? (await pinned("HEAD")).commit
const registry = value("--registry") ?? REGISTRY
const { states, marked } = await inspect(root, pin, registry)
const errors = problems(states, marked)

if (argv.includes("--json")) {
  console.log(JSON.stringify({ pin, registry, mirrors: states, marked, errors }, null, 2))
} else {
  console.log(`Mirror registry against upstream ${pin.slice(0, 11)}`)
  console.log("")
  console.log("| Upstream | Mirror | Status | Verified | At pin |")
  console.log("|---|---|---|---|---|")
  for (const state of states) {
    console.log(
      `| ${state.upstream} | ${state.entry.mirror} | ${status(state)} | ${state.entry.sha.slice(0, 11)} | ${
        state.current?.slice(0, 11) ?? "missing"
      } |`,
    )
  }
  console.log("")
  console.log(`${states.length} mirror(s) registered, ${marked.length} marker(s) found`)
  console.log("")
}

if (errors.length === 0) {
  console.error("check-mirrors: ok")
  process.exit(0)
}

for (const error of errors) console.error(error)
console.error("")
console.error(
  "A mirror is a Kilo-owned copy: upstream never edits it, so a copied change has no conflict. Re-merge it and record the new SHA.",
)
process.exit(1)
