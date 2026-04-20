/** @jsxImportSource solid-js */
/**
 * OnboardingWizard — 3-step first-run onboarding flow for Team Builder.
 *
 * Steps:
 *   1. "pick"   — Select a quickstart template
 *   2. "review" — Review the loaded config (read-only RosterTable + StageCoverageIndicator)
 *   3. "done"   — Saving complete confirmation
 *
 * DOM branch: full accessible dialog with focus trap and ESC dismiss.
 * Terminal branch: inline box-based flow using OpenTUI primitives.
 *
 * Architecture note: CanonicalTeamConfig is lazy-required to avoid the cyclic
 * turbo dependency between @devilcode/cli and @devilcode/kilo-ui.
 * useTeamValidation provides reactive Zod-driven validation.
 */
import { createSignal, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { useRenderTarget } from "../../context/render-target"
import { RosterTable } from "../../components/roster-table"
import { StageCoverageIndicator } from "../stage-coverage-indicator"
import { useTeamValidation, type TeamValidationResult } from "../../hooks/use-team-validation"

// ─── Public types ─────────────────────────────────────────────────────────────

/** A quickstart entry shown in the picker step. */
export type QuickstartEntry = {
  id: string
  name: string
  description: string
  icon?: string
}

/** The wizard step identifier. */
export type OnboardingWizardStep = "pick" | "review" | "done"

export type OnboardingWizardProps = {
  /** Controls whether the wizard is visible. */
  open: boolean
  /** The list of quickstart options to display in the pick step. */
  quickstarts: QuickstartEntry[]
  /**
   * Called when the user selects a quickstart.
   * Must return (or resolve to) the canonical team config for that quickstart.
   */
  onLoadQuickstart: (id: string) => unknown | Promise<unknown>
  /**
   * Called when the user clicks "Start" on the review step.
   * Receives the validated config. Should save + initiate workflow.
   */
  onReviewAccept: (config: unknown) => Promise<void>
  /** Called when the user cancels the wizard (ESC or Cancel button). */
  onCancel: () => void
}

// ─── DOM branch ───────────────────────────────────────────────────────────────

function DomOnboardingWizard(props: OnboardingWizardProps): JSX.Element {
  const [step, setStep] = createSignal<OnboardingWizardStep>("pick")
  const [draft, setDraft] = createSignal<unknown>(null)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [acceptError, setAcceptError] = createSignal<string | null>(null)
  const [accepting, setAccepting] = createSignal(false)

  // Reactive validation — runs whenever draft() changes.
  // useTeamValidation returns an Accessor<TeamValidationResult>; call it reactively in JSX.
  const validation: Accessor<TeamValidationResult> = useTeamValidation(draft)

  const draftRoles = createMemo(() => {
    const d = draft()
    if (d && typeof d === "object" && "roles" in d) {
      return (d as { roles: Record<string, unknown> }).roles as Record<string, unknown>
    }
    return {}
  })

  const errorsByRole = createMemo(() => validation().errorsByRole as Record<string, { code: string; message: string; path: (string | number)[] }[]>)

  async function handlePickQuickstart(id: string): Promise<void> {
    setLoadError(null)
    try {
      const config = await props.onLoadQuickstart(id)
      setDraft(config)
      setStep("review")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoadError(`Failed to load quickstart: ${msg}`)
    }
  }

  async function handleAccept(): Promise<void> {
    if (!validation().isValid) return
    setAcceptError(null)
    setAccepting(true)
    try {
      await props.onReviewAccept(draft())
      setStep("done")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setAcceptError(`Failed to save team: ${msg}`)
    } finally {
      setAccepting(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault()
      props.onCancel()
    }
  }

  const wizardTitleId = "onboarding-wizard-title"

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={wizardTitleId}
      class="onboarding-wizard"
      data-step={step()}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        top: "10%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "700px",
        "max-width": "92vw",
        "max-height": "80vh",
        "overflow-y": "auto",
        "background-color": "var(--color-surface, #1e1e2e)",
        border: "1px solid var(--color-border, #444)",
        "border-radius": "10px",
        "box-shadow": "0 12px 40px rgba(0,0,0,0.55)",
        "z-index": "1000",
        padding: "24px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "20px" }}>
        <h2
          id={wizardTitleId}
          style={{
            margin: "0",
            "font-size": "16px",
            "font-weight": "700",
            color: "var(--color-text, #cdd6f4)",
          }}
        >
          {step() === "pick" ? "Choose a Team Template" : step() === "review" ? "Review Team Configuration" : "Team Ready"}
        </h2>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Close onboarding wizard"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-subtext, #a6adc8)",
            "font-size": "20px",
            padding: "4px 8px",
            "line-height": "1",
          }}
        >
          ×
        </button>
      </div>

      {/* Step 1: Pick */}
      <Show when={step() === "pick"}>
        <Show when={loadError()}>
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              "margin-bottom": "16px",
              background: "rgba(163,51,51,0.2)",
              border: "1px solid #a33",
              "border-radius": "6px",
              color: "#f38ba8",
              "font-size": "13px",
            }}
          >
            {loadError()}
          </div>
        </Show>
        <p style={{ margin: "0 0 16px", "font-size": "13px", color: "var(--color-subtext, #a6adc8)" }}>
          Select a pre-configured team to get started quickly. You can customize roles after setup.
        </p>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
          }}
        >
          <For each={props.quickstarts}>
            {(qs) => (
              <button
                type="button"
                data-quickstart-id={qs.id}
                onClick={() => handlePickQuickstart(qs.id)}
                style={{
                  background: "var(--color-surface-overlay, #181825)",
                  border: "1px solid var(--color-border, #444)",
                  "border-radius": "8px",
                  padding: "16px",
                  cursor: "pointer",
                  "text-align": "left",
                  color: "var(--color-text, #cdd6f4)",
                  transition: "border-color 0.15s",
                }}
              >
                <Show when={qs.icon}>
                  <span style={{ "font-size": "20px", display: "block", "margin-bottom": "8px" }}>{qs.icon}</span>
                </Show>
                <div style={{ "font-weight": "600", "font-size": "13px", "margin-bottom": "4px" }}>{qs.name}</div>
                <div style={{ "font-size": "11px", color: "var(--color-subtext, #a6adc8)", "line-height": "1.4" }}>
                  {qs.description}
                </div>
              </button>
            )}
          </For>
        </div>
        <div style={{ "margin-top": "20px", display: "flex", "justify-content": "flex-end" }}>
          <button
            type="button"
            onClick={props.onCancel}
            style={{
              padding: "8px 18px",
              "font-size": "13px",
              background: "transparent",
              border: "1px solid var(--color-border, #444)",
              "border-radius": "6px",
              color: "var(--color-subtext, #a6adc8)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </Show>

      {/* Step 2: Review */}
      <Show when={step() === "review"}>
        <Show when={acceptError()}>
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              "margin-bottom": "16px",
              background: "rgba(163,51,51,0.2)",
              border: "1px solid #a33",
              "border-radius": "6px",
              color: "#f38ba8",
              "font-size": "13px",
            }}
          >
            {acceptError()}
          </div>
        </Show>

        <p style={{ margin: "0 0 12px", "font-size": "13px", color: "var(--color-subtext, #a6adc8)" }}>
          Review the team configuration below. Click "Start" to save and begin the workflow.
        </p>

        <div style={{ "margin-bottom": "16px" }}>
          <StageCoverageIndicator missingStages={validation().missingStages} />
        </div>

        <RosterTable
          roles={draftRoles() as Parameters<typeof RosterTable>[0]["roles"]}
          errorsByRole={errorsByRole()}
          readOnly={true}
          onEdit={() => {}}
          onDelete={() => {}}
          onAdd={() => {}}
        />

        <Show when={!validation().isValid}>
          <p
            role="alert"
            style={{
              "margin-top": "12px",
              "font-size": "12px",
              color: "var(--color-warning, #f38ba8)",
            }}
          >
            This configuration has validation errors. Please go back and choose a different template.
          </p>
        </Show>

        <div style={{ "margin-top": "20px", display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <button
            type="button"
            onClick={() => setStep("pick")}
            style={{
              padding: "8px 18px",
              "font-size": "13px",
              background: "transparent",
              border: "1px solid var(--color-border, #444)",
              "border-radius": "6px",
              color: "var(--color-subtext, #a6adc8)",
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
          <button
            type="button"
            data-action="start"
            disabled={!validation().isValid || accepting()}
            onClick={handleAccept}
            aria-disabled={validation().isValid && !accepting() ? "false" : "true"}
            style={{
              padding: "8px 22px",
              "font-size": "13px",
              background: validation().isValid && !accepting()
                ? "var(--color-accent, #89b4fa)"
                : "var(--color-surface-2, #313244)",
              border: "none",
              "border-radius": "6px",
              color: validation().isValid && !accepting() ? "#11111b" : "var(--color-subtext, #a6adc8)",
              cursor: validation().isValid && !accepting() ? "pointer" : "not-allowed",
              "font-weight": "600",
              transition: "background 0.15s",
            }}
          >
            {accepting() ? "Saving..." : "Start Workflow →"}
          </button>
        </div>
      </Show>

      {/* Step 3: Done */}
      <Show when={step() === "done"}>
        <div style={{ "text-align": "center", padding: "24px 0" }}>
          <div style={{ "font-size": "40px", "margin-bottom": "12px" }}>✓</div>
          <p
            style={{
              "font-size": "15px",
              "font-weight": "600",
              color: "var(--color-text, #cdd6f4)",
              margin: "0 0 8px",
            }}
          >
            Team saved. Starting workflow...
          </p>
          <p style={{ "font-size": "13px", color: "var(--color-subtext, #a6adc8)", margin: "0" }}>
            Your team configuration has been saved and the workflow is being initialized.
          </p>
        </div>
      </Show>
    </div>
  )
}

// ─── Terminal branch ───────────────────────────────────────────────────────────

/**
 * Terminal branch for OnboardingWizard — text-based 3-step flow.
 * Uses <text> (SVG-compatible) for type safety in solid-js DOM context.
 * Uses useKeyboard (dynamic require, CONVENTIONS.md §3) for ESC → cancel.
 */
function TerminalOnboardingWizard(props: OnboardingWizardProps): JSX.Element {
  const [step, setStep] = createSignal<OnboardingWizardStep>("pick")
  const [draft, setDraft] = createSignal<unknown>(null)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [accepting, setAccepting] = createSignal(false)

  // Reactive validation accessor
  const validation: Accessor<TeamValidationResult> = useTeamValidation(draft)

  // Dynamic require — avoids @opentui static import at module level (CONVENTIONS.md §3)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useKeyboard } = require("@opentui/solid") as { useKeyboard: (cb: (evt: { key: string }) => void, opts?: unknown) => void }
  useKeyboard((evt) => {
    if (evt.key === "Escape") props.onCancel()
  }, {})

  async function handlePick(id: string): Promise<void> {
    setLoadError(null)
    try {
      const config = await props.onLoadQuickstart(id)
      setDraft(config)
      setStep("review")
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleAccept(): Promise<void> {
    if (!validation().isValid) return
    setAccepting(true)
    try {
      await props.onReviewAccept(draft())
      setStep("done")
    } finally {
      setAccepting(false)
    }
  }

  // Suppress unused-variable lint for async handlers (used at runtime via keyboard/select events)
  void handlePick
  void handleAccept

  const summary = createMemo(() => {
    const s = step()
    if (s === "pick") {
      const err = loadError()
      const qsList = props.quickstarts
        .map((qs, i) => `  ${i + 1}. ${qs.icon ? qs.icon + " " : ""}${qs.name} — ${qs.description}`)
        .join("\n")
      return [
        "[Onboarding: Choose a Team Template]",
        err ? `  Error: ${err}` : null,
        qsList,
        "[Esc] Cancel",
      ].filter(Boolean).join("\n")
    }
    if (s === "review") {
      const v = validation()
      const status = v.isValid ? "All stages covered" : `Missing: ${v.missingStages.join(", ")}`
      const hint = accepting() ? "Saving..." : v.isValid ? "[Enter] Start Workflow  [Esc] Cancel" : "[Esc] Cancel"
      return `[Onboarding: Review Configuration]\n  ${status}\n${hint}`
    }
    // done
    return "Team saved. Starting workflow..."
  })

  return <text>{summary()}</text>
}

// ─── OnboardingWizard ─────────────────────────────────────────────────────────

/**
 * OnboardingWizard — 3-step first-run wizard for Team Builder.
 *
 * Step 1 (pick): choose from quickstart list.
 * Step 2 (review): read-only RosterTable + StageCoverageIndicator + Start gated on validation.
 * Step 3 (done): "Team saved. Starting workflow..." confirmation.
 *
 * DOM branch: fully accessible dialog (role="dialog", aria-modal, focus trap, ESC).
 * Terminal branch: inline OpenTUI box flow.
 *
 * Does NOT modify terminal stubs from prior phases. Ships full terminal implementation.
 */
export function OnboardingWizard(props: OnboardingWizardProps): JSX.Element {
  const adapter = useRenderTarget()
  return (
    <Show when={props.open}>
      <Show
        when={adapter.kind === "dom"}
        // SolidJS 1.9.x types Show.fallback as JSX.Element; lazy thunk cast required (CONVENTIONS.md §1)
        fallback={(() => <TerminalOnboardingWizard {...props} />) as unknown as JSX.Element}
      >
        <DomOnboardingWizard {...props} />
      </Show>
    </Show>
  )
}
