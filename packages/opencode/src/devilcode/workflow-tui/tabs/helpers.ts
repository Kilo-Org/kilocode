// packages/opencode/src/devilcode/workflow-tui/tabs/helpers.ts
// hint() helper — migrated from detail-panel.tsx (Phase 5 Wave 3, Task 2a).
// Produces stage-contextual guide text shown in the RuntimeCockpit hint panel.

import type { WorkflowViewState } from "../context"

type HintContext = Pick<
  WorkflowViewState,
  "state" | "plans" | "challenge" | "review" | "ship" | "retro" | "executing" | "pauseRequested"
>

export function hint(wf: HintContext): { title: string; body: string } {
  if (!wf.state) {
    return {
      title: "Workflow Setup",
      body: "Run /team init <quickstart> to start. Available: solo-enhanced, code-review-pair, full-stack-team, ci-cd-pipeline, research-team.",
    }
  }

  if (!wf.state.currentPhase) {
    return {
      title: "Planning Input",
      body: "Paste a short phase description below and press Enter. The planner will create the first numbered phase automatically.",
    }
  }

  switch (wf.state.currentStage) {
    case "plan":
      return {
        title: "Plan Next Step",
        body: wf.plans.length === 0
          ? "Paste phase requirements below to generate the plan."
          : "Review the task breakdown, then run challenge when the plan is ready for adversarial review.",
      }
    case "challenge":
      return {
        title: "Challenge Verdict",
        body: wf.challenge?.verdict === "revise"
          ? "The plan needs revision. Use revise to return to planning and address the recorded concerns."
          : wf.challenge?.verdict === "approved"
            ? "The challenge passed. Approve to generate contracts, then approve again to start the build."
            : "Run challenge to critique the current plan.",
      }
    case "contract":
      return {
        title: "Contract Step",
        body: "Contracts are ready. Approve to start the build, or revise to send the phase back through challenge.",
      }
    case "build":
      return {
        title: wf.pauseRequested
          ? "Build Pausing"
          : wf.state.activeTasks.some((task) => task.status === "pending") && !wf.executing
            ? "Build Paused"
            : "Build Execution",
        body: wf.pauseRequested
          ? "The current wave is still running. The build will stop before the next wave starts."
          : wf.state.activeTasks.some((task) => task.status === "pending") && !wf.executing
            ? "Run build again to resume the remaining waves."
            : "Watch task progress in the left panel and activity log. Use pause to stop after the current wave.",
      }
    case "review":
      return {
        title: "Review Status",
        body: wf.review?.blockerCount
          ? `Review found ${wf.review.blockerCount} blocker(s). Use revise to return to build and fix them.`
          : wf.review?.verdict === "pass"
            ? "Review passed. Run ship to execute final quality gates and persist ship readiness."
            : "Run review after the build completes to produce findings and a verdict.",
      }
    case "ship":
      return {
        title: "Ship Status",
        body: wf.ship?.summary ?? "Ship readiness is persisted here after final quality gates pass.",
      }
    case "retro":
      return {
        title: "Retrospective",
        body: wf.retro?.summary ?? "Run retro to capture lessons and follow-ups before starting the next phase.",
      }
  }
}
