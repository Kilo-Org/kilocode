// packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx
import { For, Show, Switch, Match, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { TabBar } from "./tabs/tab-bar"
import { AgentOutputTab } from "./tabs/agent-output-tab"
import { PlanTab } from "./tabs/plan-tab"
import { ChallengeTab } from "./tabs/challenge-tab"
import { ReviewTab } from "./tabs/review-tab"
import { ActivityTab } from "./tabs/activity-tab"

function guide(wf: ReturnType<typeof useWorkflow>) {
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

export function DetailPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const active = createMemo(() => wf.tabs.find((tab) => tab.id === wf.activeTab))
  const task = createMemo(() => wf.plans.find((plan) => plan.id === wf.selectedTask))
  const hint = createMemo(() => guide(wf))
  const summary = createMemo(() => (task() ? wf.summaries[task()!.id] : ""))

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={theme.background}
      paddingLeft={1}
      minHeight={0}
    >
      <box
        flexDirection="column"
        border={["bottom"]}
        borderColor={theme.border}
        paddingLeft={1}
        paddingRight={1}
        paddingBottom={1}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {hint().title}
        </text>
        <text fg={theme.text} wrapMode="word" width="100%">
          {hint().body}
        </text>
      </box>

      <Show when={task()}>
        {(current) => (
          <box
            flexDirection="column"
            border={["bottom"]}
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            gap={0}
          >
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              {current().id + " " + current().title}
            </text>
            <text fg={theme.textMuted}>
              {"Role: " + current().role + " | Wave: " + current().wave + " | Status: " + (wf.state?.activeTasks.find((entry) => entry.id === current().id)?.status ?? "pending")}
            </text>
            <text fg={theme.textMuted}>
              {"Depends on: " + (current().dependsOn.join(", ") || "none")}
            </text>
            <Show when={current().files.length > 0}>
              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted}>Files</text>
                <For each={current().files}>
                  {(file) => <text fg={theme.text}>{"- " + file}</text>}
                </For>
              </box>
            </Show>
            <Show when={current().verification.length > 0}>
              <box flexDirection="column" marginTop={1}>
                <text fg={theme.textMuted}>Verification</text>
                <For each={current().verification}>
                  {(line) => <text fg={theme.text}>{"- " + line}</text>}
                </For>
              </box>
            </Show>
            <box flexDirection="column" marginTop={1}>
              <text fg={theme.textMuted}>Summary</text>
              <text fg={summary() ? theme.text : theme.textMuted} wrapMode="word" width="100%">
                {summary() || "No task summary yet. Build output will be persisted here after the task completes."}
              </text>
            </box>
          </box>
        )}
      </Show>

      <TabBar />
      <box
        flexGrow={1}
        flexDirection="column"
        border={["top"]}
        borderColor={theme.border}
        minHeight={0}
      >
        <Switch fallback={<text fg={theme.textMuted}>Select a tab</text>}>
          <Match when={active()?.kind === "agent"}>
            <AgentOutputTab tabId={wf.activeTab} />
          </Match>
          <Match when={active()?.kind === "plan"}>
            <PlanTab />
          </Match>
          <Match when={active()?.kind === "challenge"}>
            <ChallengeTab />
          </Match>
          <Match when={active()?.kind === "review"}>
            <ReviewTab />
          </Match>
          <Match when={active()?.kind === "activity"}>
            <ActivityTab />
          </Match>
        </Switch>
      </box>
    </box>
  )
}
