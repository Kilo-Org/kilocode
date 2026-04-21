/** @jsxImportSource solid-js */
// packages/opencode/src/devilcode/workflow-tui/views/quickstart-loader.tsx
import { For, Show, type JSX } from "solid-js"
import { loadQuickstartTemplates, QUICKSTART_IDS } from "../../team/quickstarts"
import { useTeamBuilder } from "./team-builder-context"

export type QuickstartLoaderProps = {
  open: boolean
  onClose(): void
}

export function QuickstartLoader(props: QuickstartLoaderProps): JSX.Element {
  const builder = useTeamBuilder()
  let templates: ReturnType<typeof loadQuickstartTemplates>
  try {
    templates = loadQuickstartTemplates()
  } catch {
    templates = {} as ReturnType<typeof loadQuickstartTemplates>
  }

  return (
    <Show when={props.open}>
      <div
        data-component="quickstart-loader"
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "480px",
          "max-width": "90vw",
          background: "var(--color-surface, #1e1e2e)",
          border: "1px solid var(--color-border, #444)",
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
          "z-index": "1001",
          overflow: "hidden",
        }}
        aria-label="Load a quickstart template"
        role="dialog"
        aria-modal="true"
      >
        <div
          style={{
            padding: "12px 16px",
            "border-bottom": "1px solid var(--color-border, #444)",
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
          }}
        >
          <span style={{ "font-size": "14px", "font-weight": "600", color: "var(--color-text, #cdd6f4)" }}>
            Load Quickstart Template
          </span>
          <button
            onClick={() => props.onClose()}
            aria-label="Close quickstart loader"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-subtext, #a6adc8)",
              cursor: "pointer",
              "font-size": "18px",
              "line-height": "1",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "8px 0" }}>
          <For each={QUICKSTART_IDS}>
            {(id) => {
              const tpl = templates[id]
              if (!tpl) return null
              return (
                <button
                  data-quickstart-id={id}
                  onClick={() => {
                    builder.loadQuickstart(id)
                    props.onClose()
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "10px 16px",
                    "text-align": "left",
                    background: "transparent",
                    border: "none",
                    "border-bottom": "1px solid var(--color-border-subtle, rgba(68,68,68,0.5))",
                    color: "var(--color-text, #cdd6f4)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "2px" }}>
                    <span style={{ "font-size": "16px" }}>{tpl.icon}</span>
                    <strong style={{ "font-size": "13px" }}>{tpl.name}</strong>
                  </div>
                  <div style={{ "font-size": "12px", color: "var(--color-subtext, #a6adc8)" }}>
                    {tpl.description}
                  </div>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
