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
  /** Worktrees the pollers are currently skipping. */
  quarantined: () => string[]
  show: (text: string) => Promise<void>
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
    quarantined: host.quarantined(),
    labels,
  })
}

/** Run the diagnostics command: collect, log, and reveal the report. */
export async function runDoctor(ctx: ProjectContext | undefined, host: DoctorHost): Promise<void> {
  if (!ctx) {
    await host.show("Kilo Agent Manager — no project is open.")
    return
  }
  const text = await collect(ctx, host)
  host.log(`worktree diagnostics:\n${text}`)
  await host.show(text)
}
