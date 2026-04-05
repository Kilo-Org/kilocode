/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Font, MONO_NERD_FONTS } from "@opencode-ai/ui/font"

const meta: Meta = {
  title: "Components/Font",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

const sampleText = "The quick brown fox jumps over the lazy dog — 0123456789"
const codeText = `const greet = (name: string) => \`Hello, \${name}!\``

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px", "max-width": "700px" }}>
      <Font />
      <p style={{ "font-size": "13px", color: "var(--text-weak)", margin: 0 }}>
        The <code>Font</code> component injects <code>@font-face</code> CSS and preload <code>&lt;link&gt;</code> tags
        into <code>&lt;head&gt;</code>. The specimens below demonstrate the loaded typefaces.
      </p>
      <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <div>
          <div style={{ "font-size": "11px", color: "var(--text-weak)", "margin-bottom": "4px" }}>
            Inter (sans-serif UI font)
          </div>
          <div style={{ "font-family": "Inter, sans-serif", "font-size": "14px" }}>{sampleText}</div>
          <div style={{ "font-family": "Inter, sans-serif", "font-size": "14px", "font-weight": "700" }}>
            {sampleText} (bold)
          </div>
        </div>
        <div>
          <div style={{ "font-size": "11px", color: "var(--text-weak)", "margin-bottom": "4px" }}>
            IBM Plex Mono (default monospace)
          </div>
          <div style={{ "font-family": '"IBM Plex Mono", monospace', "font-size": "13px" }}>{codeText}</div>
          <div style={{ "font-family": '"IBM Plex Mono", monospace', "font-size": "13px", "font-weight": "700" }}>
            {codeText} (bold)
          </div>
        </div>
      </div>
    </div>
  ),
}

export const NerdFonts: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "max-width": "700px" }}>
      <Font />
      <p style={{ "font-size": "13px", color: "var(--text-weak)", margin: "0 0 8px" }}>
        All {MONO_NERD_FONTS.length} Nerd Font monospace families bundled via <code>MONO_NERD_FONTS</code>.
      </p>
      {MONO_NERD_FONTS.map((font) => (
        <div>
          <div style={{ "font-size": "11px", color: "var(--text-weak)", "margin-bottom": "2px" }}>{font.family}</div>
          <div style={{ "font-family": `"${font.family}", monospace`, "font-size": "13px" }}>{codeText}</div>
        </div>
      ))}
    </div>
  ),
}
