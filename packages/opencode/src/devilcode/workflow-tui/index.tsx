// packages/opencode/src/devilcode/workflow-tui/index.tsx
import { createResource, createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useSDK } from "@tui/context/sdk"
import { Toast } from "@tui/ui/toast"
import { createTerminalAdapter } from "@devilcode/kilo-ui/adapters/terminal"
import { RenderTargetProvider } from "@devilcode/kilo-ui/context/render-target"
import { CommandRegistryProvider, useCommandRegistry } from "@devilcode/kilo-ui/hooks/use-command-registry"
import { WorkflowProvider } from "./context"
import { WorkflowStatusBar } from "./status-bar"
import { TaskPanel } from "./task-panel"
import { DetailPanel } from "./detail-panel"
import { WorkflowCommandInput } from "./command-input"
import { TeamBuilderProvider } from "./views/team-builder-context"
import { TeamBuilderView } from "./views/team-builder-view"
import { registerTeamBuilderCommands } from "./views/team-builder-commands"
import { useTeamBuilder } from "./views/team-builder-context"

function WorkflowViewInner() {
  const route = useRoute()
  const command = useCommandDialog()
  const registry = useCommandRegistry()
  const builder = useTeamBuilder()
  const [mode, setMode] = createSignal<"workflow" | "team-builder">("workflow")

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      if (mode() === "team-builder") {
        setMode("workflow")
      } else {
        route.back()
      }
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

  // Register team-builder commands; cleanup on component disposal
  const cleanupTeamCmds = registerTeamBuilderCommands(registry.register.bind(registry), builder, {
    openBuilder: () => setMode("team-builder"),
  })
  // onCleanup is not available here (WorkflowViewInner is always mounted), but
  // the registry itself is torn down when CommandRegistryProvider unmounts.
  void cleanupTeamCmds

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={mode() === "team-builder"} fallback={
        <>
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
        </>
      }>
        <TeamBuilderView />
      </Show>
    </box>
  )
}

export function WorkflowView() {
  const sdk = useSDK()
  // createResource defers the async adapter factory; terminal is available once
  // @opentui/core dynamic import resolves (~1 frame). WorkflowViewInner is gated
  // behind <Show> so the existing TUI tree never renders with a null adapter.
  const [terminalAdapter] = createResource(createTerminalAdapter)
  return (
    <WorkflowProvider directory={sdk.directory!}>
      <Show when={terminalAdapter()}>
        {(adapter) => (
          <RenderTargetProvider adapter={adapter()}>
            <CommandRegistryProvider>
              <TeamBuilderProvider>
                <WorkflowViewInner />
              </TeamBuilderProvider>
            </CommandRegistryProvider>
          </RenderTargetProvider>
        )}
      </Show>
    </WorkflowProvider>
  )
}
