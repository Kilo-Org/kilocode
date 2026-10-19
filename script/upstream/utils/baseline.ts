/**
 * The checked-in shared-patch baseline (`script/upstream/shared-patches.json`).
 *
 * Every shared upstream file that Kilo adds or changes has an entry with its rung (plugin-first
 * order, 3 = seam patch, 4 = feature patch) and the seam that is missing. `limits` holds the counts
 * that CI accepts. A pull request that adds a shared patch adds its entry and raises the limit in
 * the same diff, so the reason is reviewed with the change.
 */

import { $ } from "bun"
import path from "node:path"

export interface BaselineEntry {
  /** Plugin-first rung: 3 = small generic seam patch, 4 = feature patch */
  rung: 3 | 4
  /** What the patch does, and which seam would remove it */
  seam: string
  /** Why the file has lines without markers (for example: JSON has no comments) */
  unmarked?: string
}

export interface Limits {
  /** Shared files that Kilo adds or changes */
  files: number
  /** Kilo lines with markers in shared files */
  markedLines: number
  /** Kilo lines without markers, in files with an `unmarked` reason */
  unmarkedLines: number
  /** Shared upstream files that Kilo deleted (workflows not included: see script/check-workflows.ts) */
  deletedFiles: number
}

export interface Baseline {
  limits: Limits
  files: Record<string, BaselineEntry>
}

export const BASELINE = "script/upstream/shared-patches.json"

export async function readBaseline(root: string, file = BASELINE): Promise<Baseline> {
  return Bun.file(path.resolve(root, file)).json()
}

export interface CheckArgs {
  pin?: string
  baseline?: string
  worktree: boolean
  json: boolean
}

export function parseArgs(argv: string[]): CheckArgs {
  const value = (name: string) => {
    const i = argv.indexOf(name)
    if (i === -1) return undefined
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
    return next
  }
  const known = new Set(["--pin", "--baseline", "--worktree", "--json"])
  const unknown = argv.find(
    (arg, i) => !known.has(arg) && !["--pin", "--baseline"].includes(argv[i - 1] ?? ""),
  )
  if (unknown) throw new Error(`Unknown argument: ${unknown}`)
  return {
    pin: value("--pin"),
    baseline: value("--baseline"),
    worktree: argv.includes("--worktree"),
    json: argv.includes("--json"),
  }
}

export async function repoRoot() {
  return (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
}
