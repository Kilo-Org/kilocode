/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DockShell, DockShellForm, DockTray } from "@opencode-ai/ui/dock-surface"

const meta: Meta = {
  title: "Components/DockSurface",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

export const Shell: Story = {
  name: "DockShell",
  render: () => (
    <DockShell style={{ padding: "12px", border: "1px solid var(--border-base)", "border-radius": "8px" }}>
      <p style={{ margin: 0, "font-size": "13px" }}>DockShell — main container body for the dock surface.</p>
    </DockShell>
  ),
}

export const Tray: Story = {
  name: "DockTray",
  render: () => (
    <DockTray style={{ padding: "8px 12px", background: "var(--background-surface)", "border-radius": "0 0 8px 8px" }}>
      <p style={{ margin: 0, "font-size": "13px" }}>DockTray — footer tray area (attach=none).</p>
    </DockTray>
  ),
}

export const TrayAttachTop: Story = {
  name: "DockTray attach=top",
  render: () => (
    <DockTray attach="top" style={{ padding: "8px 12px", background: "var(--background-surface)", "border-radius": "8px 8px 0 0" }}>
      <p style={{ margin: 0, "font-size": "13px" }}>DockTray — header tray area (attach=top).</p>
    </DockTray>
  ),
}

export const ShellWithTray: Story = {
  name: "DockShell + DockTray",
  render: () => (
    <div style={{ border: "1px solid var(--border-base)", "border-radius": "8px", overflow: "hidden" }}>
      <DockShell style={{ padding: "12px" }}>
        <p style={{ margin: 0, "font-size": "13px" }}>Body content goes here inside DockShell.</p>
      </DockShell>
      <DockTray style={{ padding: "8px 12px", display: "flex", gap: "8px", "justify-content": "flex-end" }}>
        <span style={{ "font-size": "12px", color: "var(--text-dimmed)" }}>Footer actions slot</span>
      </DockTray>
    </div>
  ),
}

export const ShellForm: Story = {
  name: "DockShellForm",
  render: () => (
    <DockShellForm style={{ padding: "12px", border: "1px solid var(--border-base)", "border-radius": "8px" }}>
      <p style={{ margin: 0, "font-size": "13px" }}>DockShellForm — shell variant using a form element.</p>
    </DockShellForm>
  ),
}
