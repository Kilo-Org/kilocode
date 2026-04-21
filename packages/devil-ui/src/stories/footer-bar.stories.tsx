/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { FooterBar } from "../primitives/footer-bar"
import { RenderTargetProvider } from "../context/render-target"
import { CommandRegistryProvider, useCommandRegistry } from "../hooks/use-command-registry"
import { createDomAdapter } from "../adapters/dom"
import type { Command } from "@devilcode/keybind"

// ─── Sample commands ──────────────────────────────────────────────────────────

const sampleCommands: Command[] = [
  {
    id: "palette",
    title: "Commands",
    description: "Open the command palette",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "Ctrl+K", leader: false },
    onSelect: () => console.log("palette selected"),
  },
  {
    id: "help",
    title: "Help",
    description: "Show keyboard shortcuts",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "?", leader: false },
    onSelect: () => console.log("help selected"),
  },
  {
    id: "paste",
    title: "Paste",
    description: "Open paste modal",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "/paste", leader: false },
    onSelect: () => console.log("paste selected"),
  },
  {
    id: "plan",
    title: "Plan Sprint",
    description: "Create a new sprint plan",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "Ctrl+P", leader: false },
    onSelect: () => console.log("plan selected"),
  },
  {
    id: "build",
    title: "Build",
    description: "Run the build pipeline",
    scope: "workflow",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "Ctrl+B", leader: false },
    onSelect: () => console.log("build selected"),
  },
  {
    id: "settings",
    title: "Settings",
    description: "Configure application settings",
    scope: "global",
    aliases: [],
    hideKeywords: [],
    hidden: false,
    keybind: { binding: "Ctrl+,", leader: false },
    onSelect: () => console.log("settings selected"),
  },
]

// ─── Adapter (module-level, shared across stories) ────────────────────────────

const adapter = createDomAdapter()

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Primitives/FooterBar",
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

function FooterBarWithCommands(props: { scope: string; max?: number; commands: Command[] }) {
  const registry = useCommandRegistry()
  for (const cmd of props.commands) {
    registry.register(cmd)
  }
  return <FooterBar scope={props.scope as any} max={props.max} />
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Default: Story = {
  render: () => (
    <div style={{ width: "100vw", height: "100vh", background: "#11111b", display: "flex", "flex-direction": "column" }}>
      <div style={{ flex: "1", padding: "16px", color: "#cdd6f4", "font-size": "13px" }}>
        FooterBar renders at the bottom — showing up to 5 global + workflow hints.
      </div>
      <CommandRegistryProvider>
        <FooterBarWithCommands scope="workflow" commands={sampleCommands} />
      </CommandRegistryProvider>
    </div>
  ),
}

export const CompactView: Story = {
  render: () => (
    <div style={{ width: "100vw", height: "100vh", background: "#11111b", display: "flex", "flex-direction": "column" }}>
      <div style={{ flex: "1", padding: "16px", color: "#cdd6f4", "font-size": "13px" }}>
        CompactView — max=3 limits display to 3 hint tiles.
      </div>
      <CommandRegistryProvider>
        <FooterBarWithCommands scope="workflow" max={3} commands={sampleCommands} />
      </CommandRegistryProvider>
    </div>
  ),
}

export const GlobalScopeOnly: Story = {
  render: () => (
    <div style={{ width: "100vw", height: "100vh", background: "#11111b", display: "flex", "flex-direction": "column" }}>
      <div style={{ flex: "1", padding: "16px", color: "#cdd6f4", "font-size": "13px" }}>
        Global scope only — shows only global commands.
      </div>
      <CommandRegistryProvider>
        <FooterBarWithCommands
          scope="global"
          commands={sampleCommands.filter((c) => c.scope === "global")}
        />
      </CommandRegistryProvider>
    </div>
  ),
}

export const EmptyRegistry: Story = {
  render: () => (
    <div style={{ width: "100vw", height: "100vh", background: "#11111b", display: "flex", "flex-direction": "column" }}>
      <div style={{ flex: "1", padding: "16px", color: "#cdd6f4", "font-size": "13px" }}>
        Empty registry — footer bar shows no hints.
      </div>
      <CommandRegistryProvider>
        <FooterBar scope="global" />
      </CommandRegistryProvider>
    </div>
  ),
}
