/** @jsxImportSource solid-js */
import { createSignal, createMemo, createEffect, untrack, For, Show, type JSX } from "solid-js"
import type { Command, CommandScope } from "@devilcode/keybind"
import { useRenderTarget, RenderSurface } from "../../context/render-target"
import { useCommandRegistry } from "../../hooks/use-command-registry"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  scope: CommandScope
  open: boolean
  onClose: () => void
  onSelect?: (cmd: Command) => void
  placeholder?: string
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

/**
 * Fuzzy-searchable command palette modal.
 * DOM branch: full interactive input + listbox.
 * Terminal branch: Phase 3 stub — full implementation in Phase 5.
 *
 * Focus is set synchronously (not in onMount) by calling
 * `adapter.setFocusedNodeId("command-palette-input")` on component init.
 */
export function CommandPalette(props: CommandPaletteProps): JSX.Element {
  const adapter = useRenderTarget()
  const registry = useCommandRegistry()

  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)

  // Set focus synchronously on component init — NOT in onMount.
  if (props.open) {
    adapter.setFocusedNodeId("command-palette-input")
  }

  const results = createMemo(() => registry.search(query(), props.scope))

  // Clamp selection index when results shrink (e.g. from registry mutations).
  // Prevents results()[selected()] returning undefined and Enter silently no-oping.
  // untrack(selected) breaks the reactive self-subscription — this effect re-triggers
  // only on results() changes, not on its own setSelected output.
  createEffect(() => {
    const len = results().length
    const cur = untrack(selected)
    if (len > 0 && cur >= len) setSelected(len - 1)
    else if (len === 0) setSelected(0)
  })

  function handleSelect(cmd: Command): void {
    props.onSelect?.(cmd)
    props.onClose()
  }

  function handleKeyDown(e: KeyboardEvent): void {
    const count = results().length
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, count - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const cmd = results()[selected()]
      if (cmd) handleSelect(cmd)
    } else if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
    }
  }

  const domBranch = (
    <Show when={props.open}>
      <div
        class="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "560px",
          "max-width": "90vw",
          "background-color": "var(--color-surface, #1e1e2e)",
          border: "1px solid var(--color-border, #444)",
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
          "z-index": "1000",
          overflow: "hidden",
        }}
      >
        <input
          id="command-palette-input"
          type="text"
          placeholder={props.placeholder ?? "Type a command..."}
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setSelected(0)
          }}
          onKeyDown={handleKeyDown}
          style={{
            width: "100%",
            padding: "12px 16px",
            "font-size": "14px",
            background: "transparent",
            border: "none",
            "border-bottom": "1px solid var(--color-border, #444)",
            color: "var(--color-text, #cdd6f4)",
            outline: "none",
            "box-sizing": "border-box",
          }}
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-controls="command-palette-listbox"
          aria-activedescendant={
            results()[selected()] ? `cmd-option-${results()[selected()].id}` : undefined
          }
        />
        <ul
          id="command-palette-listbox"
          role="listbox"
          aria-label="Commands"
          style={{
            margin: "0",
            padding: "4px 0",
            "list-style": "none",
            "max-height": "320px",
            "overflow-y": "auto",
          }}
        >
          <For each={results()}>
            {(cmd, i) => (
              /* PHASE-5-TODO: `cmd.enabled?.()` is evaluated below for aria-disabled and click
                 guard, but disabled items are intentionally kept visible in the list so users
                 can see what commands exist. Full visual polish (e.g. cursor: not-allowed,
                 skip-over with keyboard) is deferred to Phase 5. */
              <li
                id={`cmd-option-${cmd.id}`}
                role="option"
                aria-selected={i() === selected()}
                aria-disabled={cmd.enabled?.() === false ? "true" : undefined}
                onClick={() => (cmd.enabled?.() ?? true) && handleSelect(cmd)}
                onMouseEnter={() => setSelected(i())}
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "8px 16px",
                  cursor: "pointer",
                  "background-color":
                    i() === selected()
                      ? "var(--color-selection, rgba(137,180,250,0.15))"
                      : "transparent",
                  color: "var(--color-text, #cdd6f4)",
                  "font-size": "13px",
                }}
              >
                <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                  <span
                    class="cmd-title"
                    style={{
                      "font-weight": i() === selected() ? "600" : "400",
                      color:
                        cmd.enabled?.() === false
                          ? "var(--color-subtext, #a6adc8)"
                          : undefined,
                    }}
                  >
                    {cmd.title}
                  </span>
                  <Show when={cmd.description}>
                    <span
                      class="cmd-desc"
                      style={{
                        "font-size": "11px",
                        color: "var(--color-subtext, #a6adc8)",
                      }}
                    >
                      {cmd.description}
                    </span>
                  </Show>
                </div>
                <Show when={cmd.keybind}>
                  <span
                    style={{
                      "font-size": "11px",
                      color: "var(--color-subtext, #a6adc8)",
                      "font-family": "monospace",
                      "white-space": "nowrap",
                      "margin-left": "16px",
                    }}
                  >
                    {cmd.keybind!.binding}
                  </span>
                </Show>
              </li>
            )}
          </For>
          <Show when={results().length === 0}>
            <li
              style={{
                padding: "12px 16px",
                color: "var(--color-subtext, #a6adc8)",
                "font-size": "13px",
                "text-align": "center",
              }}
            >
              No commands found
            </li>
          </Show>
        </ul>
      </div>
    </Show>
  )

  const terminalBranch = (
    <Show when={props.open}>
      <div class="terminal-stub" data-primitive="command-palette">
        CommandPalette stub — full terminal implementation in Phase 5
      </div>
    </Show>
  )

  return <RenderSurface kind={adapter.kind} terminal={terminalBranch} dom={domBranch} />
}
