/**
 * Human-readable worktree health report.
 *
 * Exists because the previous answer to "why is Agent Manager empty?" was reading an output channel
 * full of per-poll failures and guessing. The report states what git and gh actually did, which
 * worktrees are unhealthy and why, and what is left on disk — in one place, copyable into an issue.
 *
 * The JetBrains plugin renders the same sections in the same order (see AgentManagerDiagnosticsAction)
 * so a report from either client can be read the same way.
 */

import { BUDGET } from "./command-budget"
import { GH } from "./gh"
import type { WorktreeHealthReport, WorktreeHealth } from "./worktree-reconcile"

export type ToolProbe = {
  /** Tool label as the report shows it, e.g. `git`. */
  name: string
  /** Version line, or undefined when the probe failed. */
  version?: string
  ms: number
  error?: string
}

export type DiagnosticsInput = {
  root: string
  worktreesDir: string
  probes: ToolProbe[]
  report: WorktreeHealthReport | undefined
  /** Worktrees currently skipped by the pollers, by id. */
  quarantined: string[]
  /** Row labels by worktree id, for a report that names things the way the UI does. */
  labels: Map<string, string>
}

const ORDER: WorktreeHealth[] = ["ok", "absent-restorable", "absent-gone", "unregistered", "unavailable"]

/** Render the report. Pure string building so it can be asserted in tests. */
export function diagnostics(input: DiagnosticsInput): string {
  const lines: string[] = []
  lines.push("Kilo Agent Manager — worktree health")
  lines.push(`repository: ${input.root}`)
  lines.push(`worktrees:  ${input.worktreesDir}`)
  lines.push("")

  lines.push("tools")
  for (const probe of input.probes) {
    const budget = probe.name === GH ? BUDGET.gh : BUDGET.probe
    const detail = probe.version ?? `FAILED — ${probe.error ?? "unknown error"}`
    lines.push(`  ${probe.name}: ${detail} (${probe.ms}ms, budget ${budget}ms)`)
  }
  lines.push("")

  const report = input.report
  if (!report) {
    lines.push("worktrees: health has not been determined yet")
    return lines.join("\n")
  }

  if (report.degraded) {
    // Worth stating plainly: every entry below reads `unavailable` for one reason, and no
    // self-healing ran, so the report must not be mistaken for "everything is broken".
    lines.push("NOTE: git could not list worktrees, so nothing was classified or repaired.")
    lines.push("")
  }

  const counts = new Map<WorktreeHealth, number>()
  for (const entry of report.entries) counts.set(entry.health, (counts.get(entry.health) ?? 0) + 1)
  lines.push("summary")
  for (const health of ORDER) lines.push(`  ${health}: ${counts.get(health) ?? 0}`)
  lines.push(`  orphan directories: ${report.orphans.length}`)
  lines.push(`  quarantined: ${input.quarantined.length}`)
  lines.push(`  pruned this pass: ${report.pruned}`)
  lines.push(`  state entries dropped: ${report.dropped.length}`)
  lines.push("")

  lines.push("worktrees")
  if (report.entries.length === 0) lines.push("  (none tracked)")
  for (const health of ORDER) {
    for (const entry of report.entries.filter((item) => item.health === health)) {
      const label = input.labels.get(entry.id) ?? entry.branch
      const flags = [
        `sessions=${entry.sessions}`,
        input.quarantined.includes(entry.id) ? "quarantined" : undefined,
      ].filter((flag) => flag !== undefined)
      lines.push(`  [${health}] ${label} — ${entry.path} (${flags.join(" ")})`)
    }
  }

  if (report.orphans.length > 0) {
    lines.push("")
    lines.push("orphan directories (nothing removes these automatically)")
    for (const orphan of report.orphans) lines.push(`  [${orphan.kind}] ${orphan.path}`)
  }
  return lines.join("\n")
}

/** Time a `--version` probe for one tool, so the report shows what the tools actually did. */
export async function probeTool(
  name: string,
  run: () => Promise<string>,
  now: () => number = Date.now,
): Promise<ToolProbe> {
  const started = now()
  try {
    return { name, version: (await run()).trim().split("\n")[0], ms: now() - started }
  } catch (error) {
    return { name, ms: now() - started, error: error instanceof Error ? error.message : String(error) }
  }
}
