/**
 * TabGroup — tabbed container with render-prop children pattern.
 *
 * Architecture:
 * - Render-prop children: children: (tab: TabDescriptor) => JSX.Element (R1-04)
 * - Active tab computed via createMemo (R1-10)
 * - Panel rendered via Show when={active()} keyed (R1-10)
 * - DOM branch: keyboard scoped to tablist container div (R1-06)
 * - Terminal branch: useKeyboard from @opentui/solid (R1-05)
 * - ARIA: role="tablist", role="tab", aria-selected (string), aria-controls, role="tabpanel"
 *
 * No TabSlot export. No compound pattern.
 * Lazy fallback form: fallback cast required (SolidJS 1.9.x types Show.fallback as JSX.Element).
 */
import { Show, For, createMemo, createSignal, onMount, onCleanup, type Accessor, type JSX } from "solid-js"
import { useRenderTarget } from "../../context/render-target"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TabDescriptor = {
  /** Unique identifier for this tab. */
  id: string
  /** Human-readable tab label. */
  label: string
  /** Whether this tab can be closed (shows close button / enables "w" key). */
  closeable?: boolean
}

export type TabGroupChildrenRender = (tab: TabDescriptor) => JSX.Element

export type TabGroupProps = {
  tabs: TabDescriptor[]
  activeTab: string
  onSwitch: (id: string) => void
  onClose?: (id: string) => void
  density?: "compact" | "expanded"
  /** Render-prop: called with the currently active tab descriptor. */
  children: TabGroupChildrenRender
}

// ---------------------------------------------------------------------------
// Terminal branch — useKeyboard from @opentui/solid (R1-05)
// ---------------------------------------------------------------------------

function TerminalBranch(props: {
  tabs: TabDescriptor[]
  activeTab: string
  active: Accessor<TabDescriptor | undefined>
  onSwitch: (id: string) => void
  onClose?: (id: string) => void
  children: TabGroupChildrenRender
}): JSX.Element {
  // Dynamic require to avoid static @opentui import at module level
  let useKeyboard: ((cb: (evt: any) => void) => void) | undefined
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const opentui = require("@opentui/solid") as { useKeyboard: (cb: (evt: any) => void) => void }
    /* eslint-enable @typescript-eslint/no-require-imports */
    useKeyboard = opentui.useKeyboard
  } catch {
    // @opentui/solid not available — skip keyboard in test environment
  }

  if (useKeyboard) {
    useKeyboard((evt: any) => {
      if (!props.tabs.length) return
      const idx = props.tabs.findIndex((t) => t.id === props.activeTab)

      if (evt.name === "tab") {
        if (!evt.shift) {
          evt.preventDefault?.()
          props.onSwitch(props.tabs[(idx + 1) % props.tabs.length]!.id)
        } else {
          evt.preventDefault?.()
          props.onSwitch(props.tabs[(idx - 1 + props.tabs.length) % props.tabs.length]!.id)
        }
        return
      }

      if (/^[1-9]$/.test(evt.name ?? "")) {
        const n = Number(evt.name) - 1
        const target = props.tabs[n]
        if (target) {
          evt.preventDefault?.()
          props.onSwitch(target.id)
        }
        return
      }

      if (evt.name === "w" && !evt.ctrl && !evt.meta) {
        const current = props.tabs[idx]
        if (current?.closeable && props.onClose) {
          evt.preventDefault?.()
          props.onClose(current.id)
        }
      }
    })
  }

  // Terminal tab bar — ASCII, no emoji
  const tabBar = () =>
    props.tabs
      .map((t) => (t.id === props.activeTab ? `[${t.label}]` : ` ${t.label} `))
      .join(" | ")

  // Terminal branch: stub using HTML elements (box/text are OpenTUI-specific intrinsics
  // not available in HTML JSX types without @opentui/solid loaded).
  return (
    <div data-component="tab-group-terminal" style={{ display: "flex", "flex-direction": "column" }}>
      <div data-role="tab-bar" style={{ "font-weight": "bold" }}>{tabBar()}</div>
      <div style={{ flex: "1", "min-width": "0" }}>
        <Show when={props.active()} keyed>
          {(tab) => <>{props.children(tab)}</>}
        </Show>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DOM branch — keyboard scoped to tablist container (R1-06)
// ---------------------------------------------------------------------------

function DomBranch(props: {
  tabs: TabDescriptor[]
  activeTab: string
  active: Accessor<TabDescriptor | undefined>
  onSwitch: (id: string) => void
  onClose?: (id: string) => void
  density?: "compact" | "expanded"
  children: TabGroupChildrenRender
}): JSX.Element {
  const [containerRef, setContainerRef] = createSignal<HTMLElement | undefined>()

  onMount(() => {
    const el = containerRef()
    if (!el) return

    const handler = (ev: KeyboardEvent): void => {
      if (!props.tabs.length) return
      const idx = props.tabs.findIndex((t) => t.id === props.activeTab)

      if (ev.key === "Tab") {
        if (!ev.shiftKey) {
          ev.preventDefault()
          props.onSwitch(props.tabs[(idx + 1) % props.tabs.length]!.id)
        } else {
          ev.preventDefault()
          props.onSwitch(props.tabs[(idx - 1 + props.tabs.length) % props.tabs.length]!.id)
        }
        return
      }

      if (/^[1-9]$/.test(ev.key)) {
        const n = Number(ev.key) - 1
        const target = props.tabs[n]
        if (target) {
          ev.preventDefault()
          props.onSwitch(target.id)
        }
        return
      }

      if (ev.key === "w" && !ev.ctrlKey && !ev.metaKey) {
        const current = props.tabs[idx]
        if (current?.closeable && props.onClose) {
          ev.preventDefault()
          props.onClose(current.id)
        }
      }
    }

    el.addEventListener("keydown", handler)
    onCleanup(() => el.removeEventListener("keydown", handler))
  })

  const isCompact = () => props.density === "compact"
  const tabHeight = () => (isCompact() ? "28px" : "36px")
  const fontSize = () => (isCompact() ? "12px" : "13px")

  return (
    <div
      ref={setContainerRef}
      data-component="tab-group"
      style={{ display: "flex", "flex-direction": "column", "min-width": "0", flex: "1" }}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        tabindex={0}
        aria-label="Tabs"
        style={{
          display: "flex",
          "align-items": "flex-end",
          "border-bottom": "1px solid #333",
          "overflow-x": "auto",
          "flex-shrink": "0",
        }}
      >
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.id === props.activeTab
            const panelId = `tabpanel-${tab.id}`
            const tabId = `tab-${tab.id}`
            return (
              <button
                id={tabId}
                role="tab"
                type="button"
                aria-selected={isActive() ? "true" : "false"}
                aria-controls={panelId}
                data-tab-id={tab.id}
                onClick={() => props.onSwitch(tab.id)}
                style={{
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "6px",
                  height: tabHeight(),
                  padding: isCompact() ? "0 10px" : "0 14px",
                  "font-size": fontSize(),
                  border: "none",
                  "border-bottom": isActive() ? "2px solid #6ea8fe" : "2px solid transparent",
                  background: isActive() ? "#1a2a3a" : "transparent",
                  color: isActive() ? "#e8e8e8" : "#888",
                  cursor: "pointer",
                  "white-space": "nowrap",
                }}
              >
                {tab.label}
                <Show when={tab.closeable && props.onClose}>
                  <span
                    aria-hidden
                    onClick={(e) => { e.stopPropagation(); props.onClose?.(tab.id) }}
                    style={{ "font-size": "14px", opacity: "0.6", "line-height": "1" }}
                  >
                    x
                  </span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>
      {/* Tab panel */}
      <div
        role="tabpanel"
        id={`tabpanel-${props.activeTab}`}
        aria-labelledby={`tab-${props.activeTab}`}
        style={{ "min-width": "0", flex: "1", overflow: "auto" }}
      >
        <Show when={props.active()} keyed>
          {(tab) => <>{props.children(tab)}</>}
        </Show>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported component (R1-10)
// ---------------------------------------------------------------------------

export function TabGroup(props: TabGroupProps): JSX.Element {
  const target = useRenderTarget()
  const active = createMemo(() => props.tabs.find((t) => t.id === props.activeTab))

  // fallback cast: SolidJS 1.9.x types fallback as JSX.Element but lazy thunk is required by plan.
  return (
    <Show
      when={target.kind === "dom"}
      fallback={
        (() => (
          <TerminalBranch
            tabs={props.tabs}
            activeTab={props.activeTab}
            active={active}
            onSwitch={props.onSwitch}
            onClose={props.onClose}
            children={props.children}
          />
        )) as unknown as JSX.Element
      }
    >
      <DomBranch
        tabs={props.tabs}
        activeTab={props.activeTab}
        active={active}
        onSwitch={props.onSwitch}
        onClose={props.onClose}
        density={props.density}
        children={props.children}
      />
    </Show>
  )
}
