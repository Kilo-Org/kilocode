/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { CommandPalette } from "../primitives/command-palette"
import { RenderTargetProvider } from "../context/render-target"
import { CommandRegistryProvider, useCommandRegistry } from "../hooks/use-command-registry"
import { createDomAdapter } from "../adapters/dom"
import type { Command } from "@devilcode/keybind"

// ─── Sample commands ──────────────────────────────────────────────────────────

const sampleCommands: Command[] = [
  {
    id: "plan",
    title: "Plan Sprint",
    description: "Create a new sprint plan with the AI agent",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+p", leader: false },
    onSelect: () => console.log("plan selected"),
  },
  {
    id: "challenge",
    title: "Challenge Assumption",
    description: "Challenge a design or architecture assumption",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    onSelect: () => console.log("challenge selected"),
  },
  {
    id: "review",
    title: "Request Review",
    description: "Request a code review from the team",
    scope: "global",
    aliases: ["review"],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+r", leader: false },
    onSelect: () => console.log("review selected"),
  },
  {
    id: "build",
    title: "Build Project",
    description: "Run the build pipeline",
    scope: "workflow",
    aliases: ["compile"],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+b", leader: false },
    onSelect: () => console.log("build selected"),
  },
  {
    id: "ship",
    title: "Ship Release",
    description: "Tag and ship the current release",
    scope: "workflow",
    aliases: ["deploy"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => console.log("ship selected"),
  },
  {
    id: "retro",
    title: "Retrospective",
    description: "Run a sprint retrospective",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    onSelect: () => console.log("retro selected"),
  },
  {
    id: "help",
    title: "Show Help",
    description: "Show keyboard shortcuts and help",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "?", leader: false },
    onSelect: () => console.log("help selected"),
  },
  {
    id: "settings",
    title: "Open Settings",
    description: "Configure application settings",
    scope: "global",
    aliases: ["preferences", "config"],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "ctrl+,", leader: false },
    onSelect: () => console.log("settings selected"),
  },
]

// ─── Adapter (module-level, shared across stories) ────────────────────────────

const adapter = createDomAdapter()

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Primitives/CommandPalette",
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

function CommandPaletteWithCommands(props: {
  open: boolean
  onClose: () => void
  placeholder?: string
}) {
  const registry = useCommandRegistry()
  for (const cmd of sampleCommands) {
    registry.register(cmd)
  }
  return (
    <CommandPalette
      scope="workflow"
      open={props.open}
      onClose={props.onClose}
      placeholder={props.placeholder}
      onSelect={(cmd) => console.log("selected:", cmd.id)}
    />
  )
}

function CommandPaletteStory(innerProps: { open: boolean; placeholder?: string }) {
  const [open, setOpen] = createSignal(innerProps.open)
  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#11111b" }}>
      <CommandRegistryProvider>
        <CommandPaletteWithCommands
          open={open()}
          onClose={() => setOpen(false)}
          placeholder={innerProps.placeholder}
        />
      </CommandRegistryProvider>
    </div>
  )
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Default: Story = {
  render: () => <CommandPaletteStory open={true} />,
}

export const WithQuery: Story = {
  render: () => <CommandPaletteStory open={true} placeholder="Search commands... (try 'pla')" />,
}

export const EmptyResults: Story = {
  render: () => (
    <CommandPaletteStory open={true} placeholder="zzznomatch — shows empty state" />
  ),
}

export const Closed: Story = {
  render: () => (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#11111b" }}>
      <p style={{ color: "#cdd6f4", padding: "16px" }}>
        CommandPalette is closed — nothing rendered.
      </p>
      <CommandRegistryProvider>
        <CommandPaletteWithCommands open={false} onClose={() => {}} />
      </CommandRegistryProvider>
    </div>
  ),
}
