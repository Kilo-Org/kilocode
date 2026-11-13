#!/usr/bin/env bun
/**
 * Mirror registry check.
 *
 * A mirror is a Kilo-owned copy of an upstream file, registered in script/upstream/mirrors.json with
 * the upstream blob SHA last verified against the pinned release and the intent of Kilo's
 * differences. Upstream never edits Kilo-owned paths, so a copied upstream change merges cleanly at
 * its own path and the copy drifts silently.
 *
 * The default run checks only the registry structure: every `// kilo_mirror: <upstream path>` copy
 * has an entry, every entry has a marked copy, and the paths agree. That is the part a normal PR can
 * be responsible for, and it needs no pin, so CI runs it.
 *
 * `--drift` additionally fails when the pinned upstream file changed or disappeared since the
 * recorded SHA. Only an upstream sync can act on that, so the sync runs it and stops while a copy is
 * behind. `--pin` implies `--drift`.
 *
 * Usage:
 *   bun script/check-mirrors.ts               # registry structure (CI)
 *   bun script/check-mirrors.ts --drift       # also HEAD's upstream pin against the recorded SHAs
 *   bun script/check-mirrors.ts --json        # machine-readable states and errors
 *   bun script/check-mirrors.ts --pin <ref>   # drift against another upstream commit
 *   bun script/check-mirrors.ts --registry <file>
 */

import path from "node:path"
import { repoRoot } from "./upstream/utils/baseline"
import { drift, inspect, problems, REGISTRY, status } from "./upstream/utils/mirrors"
import { pinned } from "./upstream/utils/upstream"

const argv = process.argv.slice(2)
const value = (name: string) => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const next = argv[i + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}
const known = new Set(["--pin", "--registry", "--json", "--drift"])
const unknown = argv.filter((arg) => arg.startsWith("--") && !known.has(arg))
if (unknown.length > 0) {
  console.error(`check-mirrors: unknown option ${unknown.join(", ")}`)
  process.exit(1)
}

const withDrift = argv.includes("--drift") || argv.includes("--pin")
const root = await repoRoot()
const pin = withDrift ? (value("--pin") ?? (await pinned("HEAD")).commit) : undefined
const registry = value("--registry") ?? REGISTRY
if (!(await Bun.file(path.resolve(root, registry)).exists())) {
  console.error(`check-mirrors: registry not found: ${registry}`)
  process.exit(1)
}
const { states, marked } = await inspect(root, registry, pin)
const structure = problems(states, marked, registry)
const changed = pin ? drift(states, registry) : []

if (argv.includes("--json")) {
  console.log(
    JSON.stringify(
      { registry, pin: pin ?? null, drift: pin !== undefined, mirrors: states, marked, structure, changed },
      null,
      2,
    ),
  )
} else {
  console.log(
    pin
      ? `Mirror registry against upstream ${pin.slice(0, 11)}`
      : "Mirror registry structure (pass --drift to compare with the pin)",
  )
  console.log("")
  console.log(pin ? "| Upstream | Mirror | Status | Verified | At pin |" : "| Upstream | Mirror | Status |")
  console.log(pin ? "|---|---|---|---|---|" : "|---|---|---|")
  for (const state of states) {
    const cells = [state.upstream, state.entry.mirror, status(state)]
    if (pin) cells.push(state.entry.sha.slice(0, 11), state.current?.slice(0, 11) ?? "missing")
    console.log(`| ${cells.join(" | ")} |`)
  }
  console.log("")
  console.log(`${states.length} mirror(s) registered, ${marked.length} marker(s) found`)
  console.log("")
}

if (structure.length + changed.length === 0) {
  console.error("check-mirrors: ok")
  process.exit(0)
}

for (const error of structure) console.error(error)
for (const error of changed) console.error(error)
console.error("")
if (structure.length > 0)
  console.error(
    "A copy is a mirror only when the registry lists it: add the entry with its upstream SHA and intent, and start the copy with `// kilo_mirror: <upstream path>`.",
  )
if (changed.length > 0)
  console.error(
    "A mirror is a Kilo-owned copy: upstream never edits it, so a copied change has no conflict. Re-merge it and record the new SHA.",
  )
process.exit(1)
