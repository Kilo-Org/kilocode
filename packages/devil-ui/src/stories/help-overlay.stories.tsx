/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { HelpOverlay } from "../primitives/help-overlay"
import { RenderTargetProvider } from "../context/render-target"
import { CommandRegistryProvider, useCommandRegistry } from "../hooks/use-command-registry"
import { createDomAdapter } from "../adapters/dom"
import type { Command, CommandScope } from "@devilcode/keybind"

// ─── Sample commands ──────────────────────────────────────────────────────────

const globalCommands: Command[] = [
  {
    id: "help",
    title: "Show Help",
    description: "Show keyboard shortcuts and help",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "?", leader: false },
  },
  {
    id: "palette",
    title: "Command Palette",
    description: "Open the command palette",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+k", leader: false },
  },
  {
    id: "settings",
    title: "Open Settings",
    description: "Configure application settings",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+,", leader: false },
  },
]

const workflowCommands: Command[] = [
  {
    id: "plan",
    title: "Plan Sprint",
    description: "Create a new sprint plan",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+p", leader: false },
  },
  {
    id: "build",
    title: "Build Project",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+b", leader: false },
  },
  {
    id: "workflow.back",
    title: "Exit Workflow",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "escape", leader: false },
  },
]

const teamBuilderCommands: Command[] = [
  {
    id: "team.add",
    title: "Add Agent",
    description: "Add a new agent to the team",
    scope: "team-builder",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+n", leader: false },
  },
  {
    id: "team.remove",
    title: "Remove Agent",
    scope: "team-builder",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+d", leader: false },
  },
]

// ─── Adapter (module-level, shared across stories) ────────────────────────────

const adapter = createDomAdapter()

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Primitives/HelpOverlay",
  decorators: [
    (Story) => (
      <RenderTargetProvider adapter={adapter}>
        <Story />
      </RenderTargetProvider>
    ),
  ],
  parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj

// ─── Helper component ─────────────────────────────────────────────────────────

function HelpOverlayWithCommands(props: {
  scope: CommandScope
  open: boolean
  onClose: () => void
  commands: Command[]
}) {
  const registry = useCommandRegistry()
  for (const cmd of props.commands) {
    registry.register(cmd)
  }
  return <HelpOverlay scope={props.scope} open={props.open} onClose={props.onClose} />
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Default: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#11111b" }}>
        <CommandRegistryProvider>
          <HelpOverlayWithCommands
            scope="global"
            open={open()}
            onClose={() => setOpen(false)}
            commands={globalCommands}
          />
        </CommandRegistryProvider>
      </div>
    )
  },
}

export const WithWorkflowScope: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#11111b" }}>
        <CommandRegistryProvider>
          <HelpOverlayWithCommands
            scope="workflow"
            open={open()}
            onClose={() => setOpen(false)}
            commands={[...globalCommands, ...workflowCommands]}
          />
        </CommandRegistryProvider>
      </div>
    )
  },
}

export const WithTeamBuilderScope: Story = {
  render: () => {
    const [open, setOpen] = createSignal(true)
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#11111b" }}>
        <CommandRegistryProvider>
          <HelpOverlayWithCommands
            scope="team-builder"
            open={open()}
            onClose={() => setOpen(false)}
            commands={[...globalCommands, ...teamBuilderCommands]}
          />
        </CommandRegistryProvider>
      </div>
    )
  },
}

export const Closed: Story = {
  render: () => (
    <div style={{ width: "100vw", height: "100vh", background: "#11111b" }}>
      <p style={{ color: "#cdd6f4", padding: "16px" }}>HelpOverlay is closed — nothing rendered.</p>
      <CommandRegistryProvider>
        <HelpOverlayWithCommands
          scope="global"
          open={false}
          onClose={() => {}}
          commands={globalCommands}
        />
      </CommandRegistryProvider>
    </div>
  ),
}
