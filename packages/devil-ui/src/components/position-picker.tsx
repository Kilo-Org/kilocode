/** @jsxImportSource solid-js */
import { createSignal, createMemo, createEffect, untrack, For, Show, type JSX } from "solid-js"
import fuzzysort from "fuzzysort"
import { useRenderTarget, RenderSurface } from "../context/render-target"

// ─── POSITION_LIBRARY lazy loader ─────────────────────────────────────────────
// @devilcode/cli is NOT listed in devil-ui's package.json dependencies.
// We use a lazy require to avoid a static import that would fail at bundle time
// in environments that don't have @devilcode/cli available (e.g. Storybook).
// Option B: lazy require pattern (mirrors use-team-validation.ts approach).

type PositionEntry = {
  id: string
  displayName: string
  tier: number
  primaryCapability: string
  canonicalCapabilities: string[]
  description: string
}

let _positionLibrary: Record<string, PositionEntry> | null = null

function getPositionLibrary(): Record<string, PositionEntry> {
  if (_positionLibrary) return _positionLibrary
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _positionLibrary = require("@devilcode/cli/devilcode/team/library").POSITION_LIBRARY as Record<
      string,
      PositionEntry
    >
  } catch {
    // Fallback: inline the 11 canonical position IDs for environments where
    // @devilcode/cli is not resolvable at runtime (e.g. Storybook).
    _positionLibrary = FALLBACK_POSITIONS
  }
  return _positionLibrary!
}

// Fallback position data matching POSITION_LIBRARY in library.ts
const FALLBACK_POSITIONS: Record<string, PositionEntry> = {
  architect: {
    id: "architect",
    displayName: "Architect",
    tier: 1,
    primaryCapability: "planning",
    canonicalCapabilities: ["planning", "design"],
    description: "Owns system design and high-level planning, delegating implementation to senior developers.",
  },
  coordinator: {
    id: "coordinator",
    displayName: "Coordinator",
    tier: 1,
    primaryCapability: "planning",
    canonicalCapabilities: ["planning", "retrospective"],
    description: "Orchestrates multi-role workflows end-to-end, driving planning and retrospective ceremonies.",
  },
  "spec-writer": {
    id: "spec-writer",
    displayName: "Spec Writer",
    tier: 2,
    primaryCapability: "design",
    canonicalCapabilities: ["design"],
    description: "Produces detailed technical specifications and API contracts from high-level requirements.",
  },
  "senior-dev": {
    id: "senior-dev",
    displayName: "Senior Developer",
    tier: 1,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation", "design"],
    description: "Leads implementation work, contributes to design decisions, and mentors junior contributors.",
  },
  developer: {
    id: "developer",
    displayName: "Developer",
    tier: 2,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation"],
    description: "Implements features and bug fixes within a defined scope, escalating blockers to senior roles.",
  },
  "frontend-specialist": {
    id: "frontend-specialist",
    displayName: "Frontend Specialist",
    tier: 2,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation"],
    description: "Focuses on UI, accessibility, and client-side implementation concerns.",
  },
  "backend-specialist": {
    id: "backend-specialist",
    displayName: "Backend Specialist",
    tier: 2,
    primaryCapability: "implementation",
    canonicalCapabilities: ["implementation"],
    description: "Focuses on APIs, data storage, and server-side implementation concerns.",
  },
  reviewer: {
    id: "reviewer",
    displayName: "Reviewer",
    tier: 2,
    primaryCapability: "review",
    canonicalCapabilities: ["review"],
    description: "Performs code and design reviews, enforcing quality gates before changes are merged.",
  },
  "qa-tester": {
    id: "qa-tester",
    displayName: "QA Tester",
    tier: 2,
    primaryCapability: "review",
    canonicalCapabilities: ["review", "testing"],
    description: "Validates correctness through exploratory and structured testing, reporting defects.",
  },
  "release-engineer": {
    id: "release-engineer",
    displayName: "Release Engineer",
    tier: 2,
    primaryCapability: "release",
    canonicalCapabilities: ["release"],
    description: "Owns CI/CD pipelines, deployment gates, and release coordination.",
  },
  researcher: {
    id: "researcher",
    displayName: "Researcher",
    tier: 3,
    primaryCapability: "research",
    canonicalCapabilities: ["research"],
    description:
      "Conducts deep-dive investigations and synthesis tasks to inform architectural and design decisions.",
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type PositionPickerProps = {
  open: boolean
  excludeIds?: string[]
  onSelect(positionId: string): void
  onClose(): void
}

// ─── DOM Branch ───────────────────────────────────────────────────────────────

function DomPositionPicker(props: PositionPickerProps): JSX.Element {
  const [query, setQuery] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const allEntries = createMemo((): PositionEntry[] => {
    const lib = getPositionLibrary()
    const excluded = new Set(props.excludeIds ?? [])
    return Object.values(lib).filter((e) => !excluded.has(e.id))
  })

  const results = createMemo((): PositionEntry[] => {
    const q = query().trim()
    const entries = allEntries()
    if (!q) return entries
    const sorted = fuzzysort.go(q, entries, {
      keys: ["displayName", "description"],
      threshold: -10000,
    })
    return sorted.map((r) => r.obj)
  })

  // Clamp effect: keep selectedIndex in bounds when results shrink.
  // untrack(selectedIndex) breaks reactive self-subscription — this effect
  // re-triggers only on results() changes, not on setSelectedIndex output.
  // Pattern mirrors command-palette (Phase 3 review fix #9).
  createEffect(() => {
    const len = results().length
    setSelectedIndex((i) => Math.min(untrack(() => i), Math.max(0, len - 1)))
  })

  function handleKeyDown(e: KeyboardEvent): void {
    // e.stopPropagation() — prevent double-close (Phase 3 review fix #7)
    e.stopPropagation()
    const count = results().length
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, count - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const entry = results()[selectedIndex()]
      if (entry) {
        props.onSelect(entry.id)
        props.onClose()
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      props.onClose()
    }
  }

  return (
    <dialog
      open={props.open}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        top: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "560px",
        "max-width": "90vw",
        "max-height": "70vh",
        "background-color": "var(--color-surface, #1e1e2e)",
        border: "1px solid var(--color-border, #444)",
        "border-radius": "8px",
        "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
        "z-index": "1000",
        overflow: "hidden",
        display: "flex",
        "flex-direction": "column",
        padding: "0",
        margin: "0",
      }}
      aria-label="Pick a position"
      aria-modal="true"
    >
      <div style={{ "border-bottom": "1px solid var(--color-border, #444)" }}>
        <input
          type="search"
          placeholder="Search positions..."
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setSelectedIndex(0)
          }}
          style={{
            width: "100%",
            padding: "12px 16px",
            "font-size": "14px",
            background: "transparent",
            border: "none",
            color: "var(--color-text, #cdd6f4)",
            outline: "none",
            "box-sizing": "border-box",
          }}
          aria-label="Search positions"
          aria-autocomplete="list"
          aria-controls="position-picker-listbox"
          aria-activedescendant={
            results()[selectedIndex()] ? `pos-option-${results()[selectedIndex()].id}` : undefined
          }
        />
      </div>

      <div
        id="position-picker-listbox"
        role="listbox"
        aria-label="Available positions"
        style={{
          "overflow-y": "auto",
          flex: "1",
          "max-height": "calc(70vh - 60px)",
        }}
      >
        <For each={results()}>
          {(entry, i) => (
            <button
              id={`pos-option-${entry.id}`}
              role="option"
              aria-selected={i() === selectedIndex()}
              onClick={() => {
                props.onSelect(entry.id)
                props.onClose()
              }}
              onMouseEnter={() => setSelectedIndex(i())}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 16px",
                "text-align": "left",
                background:
                  i() === selectedIndex()
                    ? "var(--color-selection, rgba(137,180,250,0.15))"
                    : "transparent",
                border: "none",
                "border-bottom": "1px solid var(--color-border-subtle, rgba(68,68,68,0.5))",
                color: "var(--color-text, #cdd6f4)",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "3px" }}>
                <strong style={{ "font-size": "13px", "font-weight": "600" }}>
                  {entry.displayName}
                </strong>
                <span
                  style={{
                    "font-size": "11px",
                    color: "var(--color-subtext, #a6adc8)",
                    "font-family": "monospace",
                  }}
                >
                  T{entry.tier} · {entry.primaryCapability}
                </span>
              </div>
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--color-subtext, #a6adc8)",
                  "margin-bottom": "4px",
                  "line-height": "1.4",
                }}
              >
                {entry.description}
              </div>
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "3px" }}>
                <For each={entry.canonicalCapabilities}>
                  {(cap) => (
                    <span
                      style={{
                        display: "inline-block",
                        background: "var(--color-chip-bg, rgba(137,180,250,0.1))",
                        border: "1px solid var(--color-chip-border, rgba(137,180,250,0.3))",
                        "border-radius": "3px",
                        padding: "1px 5px",
                        "font-size": "10px",
                        color: "var(--color-subtext, #a6adc8)",
                      }}
                    >
                      {cap}
                    </span>
                  )}
                </For>
              </div>
            </button>
          )}
        </For>

        <Show when={results().length === 0}>
          <div
            style={{
              padding: "24px",
              "text-align": "center",
              color: "var(--color-subtext, #a6adc8)",
              "font-size": "13px",
            }}
          >
            No positions found
          </div>
        </Show>
      </div>
    </dialog>
  )
}

// ─── Terminal Stub ────────────────────────────────────────────────────────────

function TerminalStub(): JSX.Element {
  // Phase 5 TODO: real OpenTUI position picker
  return <text>Position Picker (terminal: Phase 5)</text>
}

// ─── PositionPicker ───────────────────────────────────────────────────────────

/**
 * Fuzzy-searchable picker over POSITION_LIBRARY.
 * DOM branch: dialog with search input + fuzzysort filtering + keyboard navigation.
 * Terminal branch: Phase 5 stub.
 *
 * Excludes positions listed in `excludeIds` (e.g. already-added roles).
 */
export function PositionPicker(props: PositionPickerProps): JSX.Element {
  const adapter = useRenderTarget()
  const domBranch = <DomPositionPicker {...props} />
  const terminalBranch = <TerminalStub />
  return <RenderSurface kind={adapter.kind} terminal={terminalBranch} dom={domBranch} />
}
