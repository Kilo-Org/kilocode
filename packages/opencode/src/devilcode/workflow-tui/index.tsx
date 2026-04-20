// packages/opencode/src/devilcode/workflow-tui/index.tsx
// Phase 5 Wave 3 — 3-mode cockpit router + DensityProvider + OnboardingWizard.
// Replaces the old 2-mode router (workflow | team-builder).
import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useSDK } from "@tui/context/sdk"
import { Toast } from "@tui/ui/toast"
import { createTerminalAdapter } from "@devilcode/kilo-ui/adapters/terminal"
import { RenderTargetProvider } from "@devilcode/kilo-ui/context/render-target"
import { CommandRegistryProvider, useCommandRegistry } from "@devilcode/kilo-ui/hooks/use-command-registry"
import { DensityProvider } from "@devilcode/kilo-ui/context/density"
import { OnboardingWizard } from "@devilcode/kilo-ui/primitives/onboarding-wizard"
import { WorkflowProvider, useWorkflow } from "./context"
import { RuntimeCockpit } from "./runtime-cockpit"
import { TeamBuilderProvider, useTeamBuilder } from "./views/team-builder-context"
import { TeamBuilderView } from "./views/team-builder-view"
import { registerTeamBuilderCommands } from "./views/team-builder-commands"
import { createFileSystemTeamRepository } from "../team/repository"
import { loadQuickstartTemplates, getQuickstart } from "../team/quickstarts"
import type { QuickstartEntry } from "@devilcode/kilo-ui/primitives/onboarding-wizard"

type CockpitMode = "onboarding" | "workflow" | "team-builder"

function WorkflowViewInner() {
  const route = useRoute()
  const command = useCommandDialog()
  const registry = useCommandRegistry()
  const builder = useTeamBuilder()
  const wf = useWorkflow()
  const [mode, setMode] = createSignal<CockpitMode>("workflow")

  // teamRepo instantiated inside component body — honors AsyncLocalStorage context (R3-13)
  const teamRepo = createFileSystemTeamRepository()

  // First-run check: if no firstRunComplete persisted, show onboarding wizard
  onMount(() => {
    if (!wf.firstRunComplete) {
      setMode("onboarding")
    }
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      const m = mode()
      if (m === "team-builder" || m === "onboarding") {
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
  onCleanup(cleanupTeamCmds)

  // Build quickstart entries for the onboarding wizard picker
  function buildQuickstartEntries(): QuickstartEntry[] {
    const templates = loadQuickstartTemplates()
    return Object.values(templates).map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      icon: tpl.icon,
    }))
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Onboarding wizard — shown on first run */}
      <Show when={mode() === "onboarding"}>
        <OnboardingWizard
          open={true}
          quickstarts={buildQuickstartEntries()}
          onLoadQuickstart={async (id) => {
            const tpl = getQuickstart(id)
            if (!tpl) throw new Error(`Unknown quickstart "${id}"`)
            return tpl.team
          }}
          onReviewAccept={async (config) => {
            // R3-03: use TeamRepository.saveTeam directly — NOT builder.save()
            await teamRepo.saveTeam("default", config as any)
            await wf.markFirstRunComplete()
            setMode("workflow")
            // R3-04: startBuild is fire-and-forget — NEVER awaited
            void wf.startBuild(config as any).catch((err) => {
              console.error("[workflow] startBuild failed", err)
            })
          }}
          onCancel={() => setMode("team-builder")}
        />
      </Show>

      {/* Team builder */}
      <Show when={mode() === "team-builder"}>
        <TeamBuilderView />
      </Show>

      {/* Main workflow cockpit */}
      <Show when={mode() === "workflow"}>
        <RuntimeCockpit />
        <Toast />
      </Show>
    </box>
  )
}

/**
 * Adapter-aware shell — named component so useWorkflow() resolves in the
 * correct reactive owner (inside WorkflowProvider, not at WorkflowView root).
 * Must NOT be inlined as an anonymous Show-children accessor; SolidJS context
 * propagates through Owner chains, and a named component keeps the boundary
 * explicit and verifiable at call sites.
 */
function WorkflowViewShell(props: { adapter: Awaited<ReturnType<typeof createTerminalAdapter>> }) {
  const wf = useWorkflow()
  return (
    <RenderTargetProvider adapter={props.adapter}>
      <CommandRegistryProvider>
        {/* DensityProvider wraps the cockpit — initial from store, onPersist → Config */}
        <DensityProvider
          initial={wf.density}
          onPersist={(d) => void wf.setDensity(d)}
        >
          <TeamBuilderProvider>
            <WorkflowViewInner />
          </TeamBuilderProvider>
        </DensityProvider>
      </CommandRegistryProvider>
    </RenderTargetProvider>
  )
}

export function WorkflowView() {
  const sdk = useSDK()
  const [terminalAdapter] = createResource(createTerminalAdapter)

  return (
    <WorkflowProvider directory={sdk.directory!}>
      <Show when={terminalAdapter()}>
        {(adapter) => <WorkflowViewShell adapter={adapter()} />}
      </Show>
    </WorkflowProvider>
  )
}
