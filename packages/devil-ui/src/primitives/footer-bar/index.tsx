/** @jsxImportSource solid-js */
import { createMemo, For, Show, type JSX } from "solid-js" // Show/For used in DOM branch; createMemo for terminal
import type { Command, CommandScope } from "@devilcode/keybind"
import { useRenderTarget, RenderSurface } from "../../context/render-target"
import { useCommandRegistry } from "../../hooks/use-command-registry"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FooterBarProps {
  scope: CommandScope
  /** Maximum number of hint tiles to display. Defaults to 5. */
  max?: number
}

// ─── FooterBar ────────────────────────────────────────────────────────────────

/**
 * Context-aware action hints footer.
 * Displays top-N keybind hints for the given scope (+ global).
 * Hint display only — clicking tiles does NOT dispatch commands.
 * Keybind routing stays upstream.
 *
 * DOM branch: `<footer>` with hint `<span>` tiles.
 * Terminal branch: OpenTUI `<box>` row with action chips.
 */
export function FooterBar(props: FooterBarProps): JSX.Element {
  const adapter = useRenderTarget()
  const registry = useCommandRegistry()

  const hints = createMemo<Command[]>(() => {
    // Read entries() to establish reactivity — fires when any command changes.
    registry.entries()
    const max = props.max ?? 5
    // search("", scope) returns getAllByScope(scope) = global + scope-specific commands.
    return registry
      .search("", props.scope)
      .filter((cmd) => cmd.keybind != null)
      .slice(0, max)
  })

  const domBranch = (
    <footer
      class="footer-bar"
      role="status"
      aria-label="Keyboard shortcut hints"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "4px",
        padding: "4px 12px",
        "border-top": "1px solid var(--color-border, #313244)",
        "background-color": "var(--color-surface-footer, #181825)",
        "font-size": "11px",
        "flex-wrap": "wrap",
        "min-height": "28px",
      }}
    >
      <For each={hints()}>
        {(cmd) => (
          <span
            class="footer-bar-hint"
            title={cmd.description ?? cmd.title}
            style={{
              display: "inline-flex",
              "align-items": "center",
              gap: "4px",
              padding: "2px 6px",
              "border-radius": "3px",
              color: "var(--color-subtext, #a6adc8)",
              "white-space": "nowrap",
              cursor: "default",
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
                color: "var(--color-text, #cdd6f4)",
              }}
            >
              {cmd.keybind!.binding}
            </kbd>
            <span>{cmd.title}</span>
          </span>
        )}
      </For>
    </footer>
  )

  const terminalSummary = createMemo(() => {
    const hs = hints()
    if (hs.length === 0) return ""
    return hs.map((action) => `[${action.keybind!.binding}] ${action.title}`).join("  ")
  })

  const terminalBranch = <text>{terminalSummary()}</text>

  return <RenderSurface kind={adapter.kind} terminal={terminalBranch} dom={domBranch} />
}
