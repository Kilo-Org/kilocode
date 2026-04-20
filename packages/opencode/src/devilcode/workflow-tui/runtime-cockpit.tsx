// packages/opencode/src/devilcode/workflow-tui/runtime-cockpit.tsx
// Phase 5 Wave 3 — Cockpit Composition.
// Replaces the old WorkflowStatusBar + TabBar + DetailPanel inline tree in index.tsx.
// Uses render-prop TabGroup (R1-04/R3-08) and the DetailPanel primitive (bug fix R3-07).
import { Show, createMemo, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { StagePositionBadge } from "@devilcode/kilo-ui/primitives/stage-position-badge"
import { DetailPanel } from "@devilcode/kilo-ui/primitives/detail-panel"
import { TabGroup } from "@devilcode/kilo-ui/primitives/tab-group"
import { useStagePosition } from "@devilcode/kilo-ui/hooks/use-stage-position"
import { useDensityOptional } from "@devilcode/kilo-ui/hooks/use-density"
import { useWorkflow } from "./context"
import { useTeamBuilder } from "./views/team-builder-context"
import { hint } from "./tabs/helpers"
import { TaskPanel } from "./task-panel"
import { PlanTab } from "./tabs/plan-tab"
import { ActivityTab } from "./tabs/activity-tab"
import { ChallengeTab } from "./tabs/challenge-tab"
import { ReviewTab } from "./tabs/review-tab"
import { AgentOutputTab } from "./tabs/agent-output-tab"
import { WorkflowCommandInput } from "./command-input"
import { stageColor } from "./types"

export function RuntimeCockpit() {
  const { theme } = useTheme()
  const wf = useWorkflow()
  const builder = useTeamBuilder()
  const density = useDensityOptional()

  // Derive stage position from current workflow stage + team draft (R3-07)
  const stagePos = useStagePosition(
    () => wf.state?.currentStage ?? "plan",
    () => builder.draft,
  )

  // Currently selected task details
  const selectedTask = createMemo(() =>
    wf.plans.find((p) => p.id === wf.selectedTask),
  )

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      {/* ── Header row: phase/wave + stage position badge ─────────────────── */}
      <box
        flexDirection="row"
        height={1}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={2}
        gap={2}
        alignItems="center"
      >
        <Show
          when={wf.state}
          fallback={
            <text fg={theme.textMuted}>{"No workflow. /team init <quickstart>"}</text>
          }
        >
          {(state) => (
            <>
              <text fg={theme.primary}>
                <b>{"◆ " + (state().currentPhase || "(no phase)")}</b>
              </text>
              <text fg={stageColor(state().currentStage)}>
                <b>{state().currentStage.toUpperCase()}</b>
              </text>
              <Show when={state().activeWave !== undefined && state().totalWaves !== undefined}>
                <text fg={theme.text}>
                  {"Wave " + state().activeWave + "/" + state().totalWaves}
                </text>
              </Show>
              <Show when={wf.executing}>
                <text fg={theme.warning}>{wf.pauseRequested ? "● PAUSING" : "● EXECUTING"}</text>
              </Show>
              <Show when={!wf.executing && state().currentStage === "build" && state().activeTasks.some((task) => task.status === "pending")}>
                <text fg={theme.warning}>● PAUSED</text>
              </Show>
            </>
          )}
        </Show>

        {/* Stage position badge — shows which role covers the current stage */}
        <StagePositionBadge
          info={stagePos()}
          compact={density?.()?.density === "compact"}
        />
      </box>

      {/* ── Body: task panel + right column ───────────────────────────────── */}
      <box flexDirection="row" flexGrow={1} minWidth={0} minHeight={0}>
        <TaskPanel />

        <box
          border={["left"]}
          borderColor={"#333333"}
          flexGrow={1}
          flexDirection="column"
          minWidth={0}
          minHeight={0}
        >
          {/* Hint panel — DetailPanel primitive fixes the Phase 3 bleed bug (R3-07) */}
          <DetailPanel title={hint(wf).title} body={hint(wf).body} />

          {/* Selected-task detail — shown when a task is selected */}
          <Show when={selectedTask()}>
            {(task) => (
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
                <text fg={theme.primary}>
                  <b>{task().id + " " + task().title}</b>
                </text>
                <text fg={theme.textMuted}>
                  {"Role: " + task().role + " | Wave: " + task().wave + " | Status: " + (wf.state?.activeTasks.find((e) => e.id === task().id)?.status ?? "pending")}
                </text>
                <text fg={theme.textMuted}>
                  {"Depends on: " + (task().dependsOn.join(", ") || "none")}
                </text>
                <Show when={task().files.length > 0}>
                  <text fg={theme.textMuted}>{"Files: " + task().files.join(", ")}</text>
                </Show>
              </box>
            )}
          </Show>

          {/* Tab group via render-prop (R1-04/R3-08) — TabGroup owns the chrome */}
          <TabGroup
            tabs={wf.tabs}
            activeTab={wf.activeTab}
            onSwitch={(id) => wf.switchTab(id)}
            onClose={(id) => wf.closeTab(id)}
            density={density?.()?.density}
          >
            {(tab) => {
              // Look up kind from wf.tabs — TabDescriptor has no kind field but TabInfo does
              const info = wf.tabs.find((t) => t.id === tab.id)
              switch (info?.kind) {
                case "plan":
                  return <PlanTab />
                case "activity":
                  return <ActivityTab />
                case "challenge":
                  return <ChallengeTab />
                case "review":
                  return <ReviewTab />
                case "agent":
                  return <AgentOutputTab tabId={tab.id} />
                default:
                  return null as unknown as JSX.Element
              }
            }}
          </TabGroup>
        </box>
      </box>

      {/* ── Footer: command input ──────────────────────────────────────────── */}
      <WorkflowCommandInput />
    </box>
  )
}

