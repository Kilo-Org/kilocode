/* PHASE-5-TODO: full multiline terminal paste widget */
/** @jsxImportSource solid-js */
import { createSignal, createEffect, Show, type JSX } from "solid-js"
import { useRenderTarget, RenderSurface } from "../../context/render-target"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PasteModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (text: string) => void
}

// ─── PasteModal ───────────────────────────────────────────────────────────────

/**
 * Paste-mode modal — accepts multiline text input.
 * DOM branch: native `<dialog>` with `<textarea>`, Submit + Cancel actions.
 *             Ctrl+Enter submits; Escape cancels.
 * Terminal branch: Phase 3 stub — full multiline editor in Phase 5.
 *
 * Focus is set synchronously (not in onMount) by calling
 * `adapter.setFocusedNodeId("paste-modal-textarea")` when open prop is true.
 *
 * Controlled: caller owns `open` state.
 */
export function PasteModal(props: PasteModalProps): JSX.Element {
  const adapter = useRenderTarget()
  const [text, setText] = createSignal("")

  // Set focus synchronously on component init — NOT in onMount.
  if (props.open) {
    adapter.setFocusedNodeId("paste-modal-textarea")
  }

  // Track open changes to update focus declaratively.
  createEffect(() => {
    if (props.open) {
      adapter.setFocusedNodeId("paste-modal-textarea")
    } else {
      adapter.setFocusedNodeId(null)
    }
  })

  function handleSubmit(): void {
    const value = text().trim()
    if (value) {
      props.onSubmit(value)
      setText("")
      props.onClose()
    }
  }

  function handleClose(): void {
    setText("")
    props.onClose()
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      handleClose()
    }
  }

  const domBranch = (
    <Show when={props.open}>
      <dialog
        open={props.open}
        class="paste-modal"
        aria-label="Paste text"
        aria-modal="true"
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "600px",
          "max-width": "90vw",
          "background-color": "var(--color-surface, #1e1e2e)",
          border: "1px solid var(--color-border, #444)",
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
          "z-index": "1000",
          padding: "16px",
          margin: "0",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "12px" }}>
          <h2
            style={{
              margin: "0",
              "font-size": "15px",
              "font-weight": "600",
              color: "var(--color-text, #cdd6f4)",
            }}
          >
            Paste Text
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close paste modal"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-subtext, #a6adc8)",
              "font-size": "18px",
              padding: "4px 8px",
            }}
          >
            ×
          </button>
        </div>

        <textarea
          id="paste-modal-textarea"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste your text here..."
          rows={10}
          aria-label="Paste content"
          style={{
            width: "100%",
            resize: "vertical",
            "min-height": "160px",
            padding: "10px",
            "font-size": "13px",
            "font-family": "monospace",
            "line-height": "1.5",
            background: "var(--color-surface-2, #181825)",
            border: "1px solid var(--color-border, #444)",
            "border-radius": "4px",
            color: "var(--color-text, #cdd6f4)",
            outline: "none",
            "box-sizing": "border-box",
          }}
        />

        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "margin-top": "12px",
          }}
        >
          <span
            style={{
              "font-size": "11px",
              color: "var(--color-subtext, #a6adc8)",
            }}
          >
            <kbd
              style={{
                padding: "1px 4px",
                background: "var(--color-surface-2, #313244)",
                border: "1px solid var(--color-border, #444)",
                "border-radius": "3px",
                "font-family": "monospace",
                "font-size": "10px",
              }}
            >
              Ctrl+Enter
            </kbd>{" "}
            Submit &nbsp;
            <kbd
              style={{
                padding: "1px 4px",
                background: "var(--color-surface-2, #313244)",
                border: "1px solid var(--color-border, #444)",
                "border-radius": "3px",
                "font-family": "monospace",
                "font-size": "10px",
              }}
            >
              Esc
            </kbd>{" "}
            Cancel
          </span>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleClose}
              style={{
                padding: "6px 14px",
                "font-size": "13px",
                background: "transparent",
                border: "1px solid var(--color-border, #444)",
                "border-radius": "4px",
                color: "var(--color-subtext, #a6adc8)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              style={{
                padding: "6px 14px",
                "font-size": "13px",
                background: "var(--color-accent, #89b4fa)",
                border: "none",
                "border-radius": "4px",
                color: "#11111b",
                cursor: "pointer",
                "font-weight": "600",
              }}
            >
              Submit
            </button>
          </div>
        </div>
      </dialog>
    </Show>
  )

  const terminalBranch = (
    <Show when={props.open}>
      <div class="terminal-stub" data-primitive="paste-modal">
        <div>Paste (multiline editor: Phase 5)</div>
        <input
          type="text"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste text..."
          style={{ width: "100%" }}
        />
        <div>[Ctrl+Enter] Submit &nbsp; [Esc] Cancel</div>
      </div>
    </Show>
  )

  return <RenderSurface kind={adapter.kind} terminal={terminalBranch} dom={domBranch} />
}
