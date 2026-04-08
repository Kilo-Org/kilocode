// packages/opencode/src/devilcode/workflow-tui/index.tsx
import { useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useSDK } from "@tui/context/sdk"
import { Toast } from "@tui/ui/toast"
import { WorkflowProvider } from "./context"
import { WorkflowStatusBar } from "./status-bar"
import { TaskPanel } from "./task-panel"
import { DetailPanel } from "./detail-panel"
import { WorkflowCommandInput } from "./command-input"

function WorkflowViewInner() {
  const route = useRoute()
  const command = useCommandDialog()

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      route.back()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  command.register(() => [
    {
      value: "workflow.back",
      title: "Exit Workflow",
      category: "Workflow",
      hidden: true,
      keybind: "escape" as any,
      onSelect: () => route.back(),
    },
  ])

  return (
    <box flexDirection="column" flexGrow={1}>
      <WorkflowStatusBar />
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <TaskPanel />
        <box
          border={["left"]}
          borderColor={"#333333"}
          flexGrow={1}
          flexDirection="column"
          minHeight={0}
        >
          <DetailPanel />
        </box>
      </box>
      <WorkflowCommandInput />
      <Toast />
    </box>
  )
}

export function WorkflowView() {
  const sdk = useSDK()
  return (
    <WorkflowProvider directory={sdk.directory!}>
      <WorkflowViewInner />
    </WorkflowProvider>
  )
}
