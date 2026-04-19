/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { PasteModal } from "../primitives/paste-modal"
import { RenderTargetProvider } from "../context/render-target"
import { createDomAdapter } from "../adapters/dom"

// ─── Adapter (module-level, shared across stories) ────────────────────────────

const adapter = createDomAdapter()

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Primitives/PasteModal",
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

function PasteModalStory(props: { initialOpen: boolean }) {
  const [open, setOpen] = createSignal(props.initialOpen)
  const [lastSubmit, setLastSubmit] = createSignal<string | null>(null)

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#11111b",
        position: "relative",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <div style={{ "text-align": "center" }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            padding: "8px 16px",
            background: "var(--color-accent, #89b4fa)",
            border: "none",
            "border-radius": "4px",
            color: "#11111b",
            cursor: "pointer",
            "font-size": "13px",
            "font-weight": "600",
          }}
        >
          Open Paste Modal
        </button>
        {lastSubmit() && (
          <p style={{ color: "#a6e3a1", "font-size": "12px", "margin-top": "12px" }}>
            Submitted: "{lastSubmit()!.slice(0, 60)}{lastSubmit()!.length > 60 ? "..." : ""}"
          </p>
        )}
      </div>

      <PasteModal
        open={open()}
        onClose={() => setOpen(false)}
        onSubmit={(text) => {
          setLastSubmit(text)
          setOpen(false)
          console.log("PasteModal submitted:", text)
        }}
      />
    </div>
  )
}

// ─── Stories ──────────────────────────────────────────────────────────────────

export const Open: Story = {
  render: () => <PasteModalStory initialOpen={true} />,
}

export const Closed: Story = {
  render: () => (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#11111b",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <PasteModalStory initialOpen={false} />
    </div>
  ),
}
