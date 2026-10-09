/**
 * Collects and shows the worktree-health report for the active project.
 *
 * Separate from the report rendering (worktree-diagnostics.ts) so the rendering stays pure and
 * testable, and separate from AgentManagerProvider so the provider does not grow another concern.
 */

import { execWithShellEnv } from "./shell-env"
import { BUDGET } from "./command-budget"
import { GH, execGhRead } from "./gh"
import { diagnostics, probeTool, type ToolProbe } from "./worktree-diagnostics"
import type { ProjectContext } from "./project/context"
import type { WorktreeHealthReport } from "./worktree-reconcile"

export interface DoctorHost {
  /** Re-run the reconcile so the report reflects the current state rather than the last poll. */
  reconcile: (ctx: ProjectContext) => Promise<WorktreeHealthReport | undefined>
  /** Worktrees the pollers are currently skipping, from every loop that parks them. */
  quarantined: () => string[]
  /** Where the report is written; `show` reveals the channel when the host supports it. */
  out: { appendLine: (text: string) => void; show?: () => void }
  log: (...args: unknown[]) => void
}

/** Build the report for one project, refreshing health first. */
export async function collect(ctx: ProjectContext, host: DoctorHost): Promise<string> {
  const manager = ctx.worktreeManager()
  const report = await host.reconcile(ctx)
  const probes: ToolProbe[] = [
    await probeTool(
      "git",
      async () => (await execWithShellEnv("git", ["--version"], { timeout: BUDGET.probe })).stdout,
    ),
    // Through execGhRead so the probe cannot be the one gh call that flashes a console on Windows.
    await probeTool(GH, async () => (await execGhRead(["--version"], { timeout: BUDGET.gh })).stdout),
  ]
  const state = ctx.peekState()
  const labels = new Map((state?.getWorktrees() ?? []).map((wt) => [wt.id, wt.label || wt.branch]))
  return diagnostics({
    root: ctx.root,
    worktreesDir: manager.worktreesDir,
    probes,
    report,
    // One loop parking a worktree and another parking the same one is one line in the report.
    quarantined: [...new Set(host.quarantined())],
    labels,
  })
}

/** Run the diagnostics command: collect, log, and reveal the report. */
export async function runDoctor(ctx: ProjectContext | undefined, host: DoctorHost): Promise<void> {
  if (!ctx) {
    show(host, "Kilo Agent Manager — no project is open.")
    return
  }
  const text = await collect(ctx, host)
  host.log(`worktree diagnostics:\n${text}`)
  show(host, text)
}

function show(host: DoctorHost, text: string): void {
  host.out.appendLine(text)
  host.out.show?.()
}
