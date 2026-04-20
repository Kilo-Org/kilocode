/**
 * DetailPanel — collapsible detail panel showing a title + body text.
 *
 * BUG FIX (referenced from workflow-tui/detail-panel.tsx lines 113-115):
 *   The upstream TUI component sets width="100%" on the inner text element,
 *   which causes layout overflow in OpenTUI's flex box model. The correct layout
 *   is to set flexGrow={1} minWidth={0} on the wrapping box, letting the text
 *   naturally fill the available space without explicit percentage widths.
 *
 * Terminal branch layout (OpenTUI semantics, rendered via h() to avoid TSX intrinsic errors):
 *   box [border, paddingLeft=1, paddingRight=1, flexDirection="column"]
 *     text [bold] {title}
 *     box [flexGrow=1, minWidth=0]   <-- BUG FIX: NOT width on text
 *       text [wrapMode="word"] {body}
 *
 * DOM branch: semantic details/summary with density-aware styling.
 * Lazy fallback form: fallback cast required (SolidJS 1.9.x types Show.fallback as JSX.Element).
 * Uses useDensityOptional() — works with or without a DensityProvider.
 */
import { Show, type JSX } from "solid-js"
import { useRenderTarget } from "../../context/render-target"
import { useDensityOptional } from "../../hooks/use-density"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DetailPanelProps = {
  title: string
  body: string
  /** Whether the panel is open/expanded. DOM-only prop (terminal always shows). */
  open?: boolean
  /** Called when DOM details toggle fires. */
  onToggle?: (open: boolean) => void
  /** Additional CSS class for DOM branch. */
  class?: string
}

// ---------------------------------------------------------------------------
// Terminal branch — OpenTUI layout via dynamic h() to bypass TSX intrinsic errors.
// BUG FIX: flexGrow={1} minWidth={0} on inner box — NOT width on text node.
// ---------------------------------------------------------------------------

function TerminalBranch(props: Pick<DetailPanelProps, "title" | "body">): JSX.Element {
  // Build OpenTUI element tree via require("solid-js/h") to avoid TSX intrinsic type errors.
  // This pattern is used when @opentui/solid is not statically importable from this package.
  let h: ((tag: string | ((...args: any[]) => any), props?: any, ...children: any[]) => any) | undefined
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    h = require("solid-js/h") as typeof h
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    h = undefined
  }

  if (h) {
    // OpenTUI terminal layout:
    // box [border, paddingLeft=1, paddingRight=1]
    //   text [bold] → title
    //   box [flexGrow=1, minWidth=0]   ← BUG FIX: not width="100%" on text
    //     text [wrapMode="word"] → body
    return h("box", { border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column" },
      h("text", { bold: true }, props.title),
      h("box", { flexGrow: 1, minWidth: 0 },
        h("text", { wrapMode: "word" }, props.body),
      ),
    ) as unknown as JSX.Element
  }

  // Fallback to plain text stub for environments without solid-js/h
  return (
    <div data-component="detail-panel-terminal">
      <div data-role="title" style={{ "font-weight": "bold" }}>{props.title}</div>
      {/* BUG FIX: minWidth=0, no width="100%" on text node */}
      <div data-role="body" style={{ "min-width": "0", "word-wrap": "break-word" }}>{props.body}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DOM branch
// ---------------------------------------------------------------------------

function DomBranch(props: DetailPanelProps & { isCompact: boolean }): JSX.Element {
  const padValue = props.isCompact ? "6px 10px" : "10px 16px"
  const fontSizeValue = props.isCompact ? "13px" : "14px"

  return (
    <details
      class={props.class}
      open={props.open}
      data-component="detail-panel"
      style={{
        border: "1px solid #333",
        "border-radius": "4px",
        overflow: "hidden",
        "min-width": "0",
      }}
      onToggle={(e) => props.onToggle?.((e.target as HTMLDetailsElement).open)}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: padValue,
          "font-size": fontSizeValue,
          "font-weight": "600",
          background: "#1a1a1a",
          "border-bottom": "1px solid #333",
          "user-select": "none",
          "list-style": "none",
          display: "flex",
          "align-items": "center",
          gap: "6px",
        }}
      >
        <span aria-hidden>&#9656;</span>
        {props.title}
      </summary>
      <div
        style={{
          padding: padValue,
          "font-size": fontSizeValue,
          "line-height": "1.5",
          "white-space": "pre-wrap",
          "word-break": "break-word",
          "min-width": "0",
        }}
      >
        {props.body}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

export function DetailPanel(props: DetailPanelProps): JSX.Element {
  const target = useRenderTarget()
  const densityCtx = useDensityOptional()

  const isCompact = (): boolean => densityCtx?.()?.density === "compact"

  // fallback cast: SolidJS 1.9.x types fallback as JSX.Element but lazy thunk is required by plan.
  return (
    <Show
      when={target.kind === "dom"}
      fallback={(() => <TerminalBranch title={props.title} body={props.body} />) as unknown as JSX.Element}
    >
      <DomBranch {...props} isCompact={isCompact()} />
    </Show>
  )
}
