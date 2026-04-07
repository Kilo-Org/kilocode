// packages/opencode/src/devilcode/workflow-tui/command-input.tsx
import { TextAttributes, type TextareaRenderable, type KeyBinding } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { useWorkflow } from "./context"
import { isWorkflowCommand } from "./types"

export function WorkflowCommandInput() {
  const { theme } = useTheme()
  const route = useRoute()
  const toast = useToast()
  const wf = useWorkflow()

  let input: TextareaRenderable

  async function handleCommand(raw: string) {
    const trimmed = raw.trim().toLowerCase()
    if (!trimmed) return

    if (trimmed === "back") {
      route.back()
      return
    }

    if (trimmed === "status") {
      await wf.refresh()
      toast.show({ message: "State refreshed", variant: "info", duration: 2000 })
      return
    }

    if (trimmed === "pause") {
      wf.pause()
      toast.show({ message: "Paused after current wave", variant: "warning", duration: 3000 })
      return
    }

    if (trimmed === "approve") {
      if (wf.state?.currentStage === "challenge") {
        await wf.executeStage("build")
        toast.show({ message: "Plan approved — advancing to BUILD", variant: "success", duration: 3000 })
      } else {
        toast.show({ message: "Nothing to approve at this stage", variant: "warning", duration: 2000 })
      }
      return
    }

    if (trimmed === "revise") {
      if (wf.state?.currentStage === "challenge") {
        await wf.executeStage("plan")
        toast.show({ message: "Sending back for revision", variant: "info", duration: 3000 })
      }
      return
    }

    if (trimmed === "next") {
      if (!wf.state) {
        toast.show({ message: "No workflow initialized", variant: "error", duration: 2000 })
        return
      }
      // Advance to the next valid stage
      const { Workflow } = await import("../workflow")
      const next = Workflow.nextStage(wf.state.currentStage)
      await wf.executeStage(next)
      return
    }

    if (trimmed.startsWith("task ")) {
      const taskId = trimmed.slice(5).trim()
      wf.selectTask(taskId)
      return
    }

    // Check if it's a stage command
    if (isWorkflowCommand(trimmed)) {
      try {
        await wf.executeStage(trimmed as any)
      } catch (e: any) {
        toast.show({ message: e.message ?? "Stage transition failed", variant: "error", duration: 4000 })
      }
      return
    }

    // Free-text — would be sent to orchestrator as guidance
    toast.show({ message: "Sent guidance to orchestrator", variant: "info", duration: 2000 })
  }

  function submit() {
    if (!input) return
    const text = input.plainText.trim()
    if (!text) return
    input.clear()
    handleCommand(text).catch((e) => {
      toast.show({ message: String(e), variant: "error", duration: 4000 })
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
        placeholder="plan | build | review | ship | next | pause | back"
        textColor={theme.text}
        focusedTextColor={theme.text}
        minHeight={1}
        maxHeight={1}
        flexGrow={1}
        cursorColor={theme.text}
        focusedBackgroundColor={theme.backgroundElement}
        keyBindings={[
          { name: "return", action: "submit" } satisfies KeyBinding,
        ]}
        onSubmit={submit}
      />
    </box>
  )
}
