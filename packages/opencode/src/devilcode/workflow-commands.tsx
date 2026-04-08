// packages/opencode/src/devilcode/workflow-commands.tsx
import { useCommandDialog } from "@tui/component/dialog-command"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { WorkflowStateManager } from "./workflow/state"

export function registerWorkflowCommands() {
  const command = useCommandDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()

  command.register(() => [
    {
      value: "workflow.open",
      title: "Team Workflow",
      description: "Open the workflow mission control dashboard",
      category: "Workflow",
      slash: { name: "team", aliases: ["workflow"] },
      onSelect: () => {
        route.navigate({ type: "workflow" })
      },
    },
    {
      value: "workflow.init",
      title: "Initialize Team Workflow",
      description: "Create .planning/ directory and start a new workflow",
      category: "Workflow",
      slash: { name: "team init" },
      onSelect: async () => {
        try {
          const directory = sdk.directory!
          const manager = new WorkflowStateManager(directory)
          if (await manager.hasWorkflow()) {
            toast.show({
              message: "Workflow already initialized. Use /team to open.",
              variant: "info",
              duration: 3000,
            })
            route.navigate({ type: "workflow" })
            return
          }
          const projectName = directory.split(/[/\\]/).pop() ?? "project"
          await manager.initialize(projectName)
          toast.show({
            message: "Workflow initialized. Opening dashboard...",
            variant: "success",
            duration: 3000,
          })
          route.navigate({ type: "workflow" })
        } catch (e: any) {
          toast.show({
            message: "Failed to initialize: " + (e.message ?? String(e)),
            variant: "error",
            duration: 5000,
          })
        }
      },
    },
  ])
}
