// packages/opencode/src/devilcode/workflow-tui/command-input.tsx
import { TextAttributes, type TextareaRenderable, type KeyBinding } from "@opentui/core"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { onMount } from "solid-js"
import { CanonicalTeamConfig } from "../team/config"
import { useWorkflow } from "./context"
import { Review } from "../review/review"
import { Workflow } from "../workflow"
import { WorkflowStateManager } from "../workflow/state"
import { WorkflowStage, type WorkflowStage as WorkflowStageType } from "../workflow/types"

export function WorkflowCommandInput() {
  const local = useLocal()
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const wf = useWorkflow()

  let input: TextareaRenderable

  onMount(() => {
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
    }, 1)
  })

  function error(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function model() {
    const info = local.model.current()
    if (!info) {
      throw new Error("No model selected. Pick a model before running workflow stages.")
    }
    return info
  }

  function team() {
    const result = CanonicalTeamConfig.safeParse((sync.data.config as { team?: unknown }).team)
    if (!result.success || !result.data.enabled) return undefined
    return result.data
  }

  async function phase(input?: string) {
    const dir = sdk.directory
    if (!dir) {
      throw new Error("No project directory is available for the workflow.")
    }

    const manager = new WorkflowStateManager(dir)
    const state = wf.state ?? await manager.readState()

    if (input) {
      const next = await manager.ensurePhase(input)
      await manager.writePhaseContext(next, input)
      await wf.refresh()
      return input
    }

    if (!state.currentPhase) {
      throw new Error("No phase requirements yet. Paste a short phase description to start planning.")
    }

    const text = await manager.readPhaseContext(state.currentPhase).catch(() => "")
    if (text.trim()) return text
    throw new Error("The current phase has no context yet. Paste requirements into the workflow prompt to seed planning.")
  }

  async function diff() {
    const branch = await Review.getBranchChanges().then((x) => x.raw)
    if (branch.trim()) return branch

    const tree = await Review.getUncommittedChanges().then((x) => x.raw)
    if (tree.trim()) return tree

    throw new Error("No diff available for review yet.")
  }

  async function run(stage: WorkflowStageType, opts?: { phase?: string }) {
    const state = wf.state
    if (!state) {
      throw new Error("No workflow initialized. Run /team init <quickstart> first.")
    }

    const info = stage === "plan" || stage === "challenge" || stage === "review"
      ? model()
      : undefined
    const ctx = stage === "plan" || stage === "challenge" ? await phase(opts?.phase) : undefined
    const patch = stage === "review" ? await diff() : undefined

    await wf.dispatchStage(stage, info, {
      phaseContext: ctx,
      teamConfig: team(),
      diff: patch,
    })
  }

  async function handleCommand(raw: string) {
    const text = raw.trim()
    const cmd = text.toLowerCase()
    if (!cmd) return

    if (cmd === "back") {
      route.back()
      return
    }

    if (cmd === "status") {
      await wf.refresh()
      toast.show({ message: "State refreshed", variant: "info", duration: 2000 })
      return
    }

    if (cmd === "pause") {
      if (!wf.pause()) {
        toast.show({ message: "No active build wave to pause", variant: "warning", duration: 3000 })
        return
      }
      toast.show({ message: "Pausing after the current wave. Run build again to resume.", variant: "warning", duration: 3000 })
      return
    }

    if (cmd === "approve") {
      const stage = wf.state ? Workflow.resolveAction(wf.state.currentStage, "approve") : undefined
      if (!stage) {
        toast.show({ message: "Nothing to approve at this stage", variant: "warning", duration: 2000 })
        return
      }

      await run(stage)
      return
    }

    if (cmd === "revise") {
      const stage = wf.state ? Workflow.resolveAction(wf.state.currentStage, "revise") : undefined
      if (!stage) {
        toast.show({ message: "Nothing to revise at this stage", variant: "warning", duration: 2000 })
        return
      }

      await run(stage)
      return
    }

    if (cmd === "next") {
      if (!wf.state) {
        toast.show({ message: "No workflow initialized. Run /team init <quickstart> first.", variant: "error", duration: 2000 })
        return
      }
      await run(Workflow.resolveAction(wf.state.currentStage, "next")!)
      return
    }

    if (cmd.startsWith("task ")) {
      const taskId = text.slice(5).trim()
      wf.selectTask(taskId)
      return
    }

    const parsed = WorkflowStage.safeParse(cmd)
    if (parsed.success) {
      try {
        await run(parsed.data)
      } catch (err) {
        toast.show({ message: error(err), variant: "error", duration: 4000 })
      }
      return
    }

    if (wf.state?.currentStage === "plan") {
      try {
        await run("plan", { phase: text })
        toast.show({ message: "Planning started", variant: "success", duration: 3000 })
      } catch (err) {
        toast.show({ message: error(err), variant: "error", duration: 4000 })
      }
      return
    }

    toast.show({ message: "Free-text guidance is only wired for the planning stage right now", variant: "info", duration: 3000 })
  }

  function submit() {
    if (!input) return
    const text = input.plainText.trim()
    if (!text) return
    input.clear()
    handleCommand(text).catch((err) => {
      toast.show({ message: error(err), variant: "error", duration: 4000 })
    })
  }

  return (
    <box
      flexDirection="row"
      height={2}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={theme.backgroundPanel}
      alignItems="center"
      gap={1}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        workflow&gt;
      </text>
      <textarea
        ref={(r: TextareaRenderable) => {
          input = r
        }}
        placeholder="paste phase requirements or enter a workflow command"
        textColor={theme.text}
        focusedTextColor={theme.text}
        minHeight={1}
        maxHeight={1}
        flexGrow={1}
        cursorColor={theme.text}
        focusedBackgroundColor={theme.backgroundElement}
        onMouseDown={(evt) => evt.target?.focus()}
        keyBindings={[
          { name: "return", action: "submit" } satisfies KeyBinding,
        ]}
        onSubmit={submit}
      />
    </box>
  )
}
