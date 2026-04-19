// packages/opencode/src/devilcode/workflow-commands.tsx
import { useCommandDialog } from "@tui/component/dialog-command"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { WorkflowStateManager } from "./workflow/state"
import { Config } from "@/config/config"
import { loadQuickstartTemplates, QUICKSTART_IDS } from "./team"

export function registerWorkflowCommands() {
  const command = useCommandDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()

  // Hoist outside register callback to avoid hot-path re-loads on every render.
  const templates = loadQuickstartTemplates()

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

    // Per-quickstart sub-commands: /team init <id>
    ...QUICKSTART_IDS.map((id) => {
      const template = templates[id]
      return {
        value: `workflow.init.${id}`,
        title: `Initialize Workflow — ${template.name}`,
        description: template.description,
        category: "Workflow Init",
        slash: { name: `team init ${id}` },
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
            // Config.update takes full Info — read-then-merge to avoid clobbering other fields.
            const current = await Config.get()
            await Config.update({ ...current, team: template.team })
            await manager.initialize(projectName)
            toast.show({
              message: `Initialized with ${template.name}. Opening dashboard...`,
              variant: "success",
              duration: 3000,
            })
            route.navigate({ type: "workflow" })
          } catch (e: any) {
            toast.show({
              message: `Failed to initialize: ${e.message ?? String(e)}`,
              variant: "error",
              duration: 5000,
            })
          }
        },
      }
    }),

    // No-arg entry: /team init (shows guidance)
    {
      value: "workflow.init",
      title: "Initialize Team Workflow",
      description: `Pick a quickstart: ${QUICKSTART_IDS.join(", ")}`,
      category: "Workflow",
      slash: { name: "team init" },
      onSelect: async () => {
        toast.show({
          message: `Pick a quickstart: ${QUICKSTART_IDS.join(" | ")}. Run /team init <id>.`,
          variant: "info",
          duration: 5000,
        })
      },
    },
  ])
}
