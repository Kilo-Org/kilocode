/** @jsxImportSource solid-js */
import { createMemo, For, Show, type JSX } from "solid-js"
import type { Command, CommandScope } from "@devilcode/keybind"
import { useRenderTarget, RenderSurface } from "../../context/render-target"
import { useCommandRegistry } from "../../hooks/use-command-registry"

// ─── Terminal branch ──────────────────────────────────────────────────────────

/**
 * Terminal branch for HelpOverlay — keybind grid grouped by scope.
 * Uses useCommandRegistry (not useKeybindRegistry — does not exist).
 * Renders as <text> summary (SVG-compatible, type-safe in solid-js DOM context).
 * ESC → props.onClose via useKeyboard (dynamic require, CONVENTIONS.md §3).
 */
function TerminalHelpOverlay(props: HelpOverlayProps): JSX.Element {
  const registry = useCommandRegistry()

  const groups = createMemo(() => {
    const cmds = registry.search("", props.scope)
    const byScope: Record<string, Command[]> = {}
    for (const c of cmds) {
      if (!c.keybind) continue
      const s = c.scope ?? "global"
      ;(byScope[s] ??= []).push(c)
    }
    return Object.entries(byScope).sort(([a], [b]) => a.localeCompare(b))
  })

  // Dynamic require — avoids @opentui static import at module level (CONVENTIONS.md §3)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useKeyboard } = require("@opentui/solid") as { useKeyboard: (cb: (evt: { key: string }) => void, opts?: unknown) => void }
  useKeyboard((evt) => {
    if (evt.key === "Escape") props.onClose()
  }, {})

  const summary = createMemo(() => {
    const gs = groups()
    if (gs.length === 0) return "[Keyboard Shortcuts: none for this context]\n[Esc] Close"
    const lines: string[] = ["[Keyboard Shortcuts]"]
    for (const [scope, cmds] of gs) {
      lines.push(`  ${scope.toUpperCase()}`)
      for (const cmd of cmds) {
        const kb = cmd.keybind ? cmd.keybind.binding : "—"
        lines.push(`    ${cmd.title.padEnd(24)} ${kb}`)
      }
    }
    lines.push("[Esc] Close")
    return lines.join("\n")
  })

  return <text>{summary()}</text>
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HelpOverlayProps {
  scope: CommandScope
  open: boolean
  onClose: () => void
}

interface CommandGroup {
  heading: string
  commands: Command[]
}

// ─── HelpOverlay ──────────────────────────────────────────────────────────────

/**
 * Keybind reference overlay — displays all commands for the given scope
 * grouped by scope heading.
 * DOM branch: grouped table layout.
 * Terminal branch: OpenTUI grouped keybind grid via useCommandRegistry.
 *
 * Press Escape to close.
 */
export function HelpOverlay(props: HelpOverlayProps): JSX.Element {
  const adapter = useRenderTarget()
  const registry = useCommandRegistry()

  // Set focus synchronously on component init — NOT in onMount.
  if (props.open) {
    adapter.setFocusedNodeId("help-overlay")
  }

  const groups = createMemo<CommandGroup[]>(() => {
    // Read entries() to establish reactivity — fires when any command changes.
    registry.entries()
    // search("", scope) returns getAllByScope(scope) = global + scope-specific commands.
    const all = registry.search("", props.scope)

    const byScope = new Map<string, Command[]>()
    for (const cmd of all) {
      const heading = cmd.scope === "global" ? "Global" : capitalize(cmd.scope)
      const group = byScope.get(heading) ?? []
      group.push(cmd)
      byScope.set(heading, group)
    }

    return Array.from(byScope.entries()).map(([heading, commands]) => ({ heading, commands }))
  })

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
    }
  }

  const domBranch = (
    <Show when={props.open}>
      <div
        id="help-overlay"
        class="help-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "640px",
          "max-width": "90vw",
          "max-height": "75vh",
          "overflow-y": "auto",
          "background-color": "var(--color-surface, #1e1e2e)",
          border: "1px solid var(--color-border, #444)",
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
          "z-index": "1000",
          padding: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "margin-bottom": "16px",
          }}
        >
          <h2
            style={{
              margin: "0",
              "font-size": "15px",
              "font-weight": "600",
              color: "var(--color-text, #cdd6f4)",
            }}
          >
            Keyboard Shortcuts
          </h2>
          <button
            onClick={props.onClose}
            aria-label="Close keyboard shortcuts"
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

        <For each={groups()}>
          {(group) => (
            <section style={{ "margin-bottom": "20px" }}>
              <h3
                style={{
                  margin: "0 0 8px 0",
                  "font-size": "11px",
                  "font-weight": "600",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.08em",
                  color: "var(--color-accent, #89b4fa)",
                }}
              >
                {group.heading}
              </h3>
              <table
                style={{
                  width: "100%",
                  "border-collapse": "collapse",
                }}
                role="table"
                aria-label={`${group.heading} shortcuts`}
              >
                <tbody>
                  <For each={group.commands}>
                    {(cmd) => (
                      <tr
                        style={{
                          "border-bottom": "1px solid var(--color-border-subtle, #313244)",
                        }}
                      >
                        <td
                          style={{
                            padding: "6px 0",
                            "font-size": "13px",
                            color: "var(--color-text, #cdd6f4)",
                            width: "60%",
                          }}
                        >
                          {cmd.title}
                          <Show when={cmd.description}>
                            <span
                              style={{
                                display: "block",
                                "font-size": "11px",
                                color: "var(--color-subtext, #a6adc8)",
                                "margin-top": "2px",
                              }}
                            >
                              {cmd.description}
                            </span>
                          </Show>
                        </td>
                        <td
                          style={{
                            padding: "6px 0",
                            "font-size": "12px",
                            "font-family": "monospace",
                            color: "var(--color-subtext, #a6adc8)",
                            "text-align": "right",
                          }}
                        >
                          <Show when={cmd.keybind} fallback={<span>—</span>}>
                            <kbd
                              style={{
                                padding: "2px 6px",
                                background: "var(--color-surface-2, #313244)",
                                border: "1px solid var(--color-border, #444)",
                                "border-radius": "3px",
                                "font-family": "monospace",
                                "font-size": "11px",
                              }}
                            >
                              {cmd.keybind!.binding}
                            </kbd>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
          )}
        </For>

        <Show when={groups().length === 0}>
          <p
            style={{
              color: "var(--color-subtext, #a6adc8)",
              "font-size": "13px",
              "text-align": "center",
              margin: "24px 0",
            }}
          >
            No shortcuts registered for this context.
          </p>
        </Show>
      </div>
    </Show>
  )

  const terminalBranch = (
    <Show when={props.open}>
      <TerminalHelpOverlay {...props} />
    </Show>
  )

  return <RenderSurface kind={adapter.kind} terminal={terminalBranch} dom={domBranch} />
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
