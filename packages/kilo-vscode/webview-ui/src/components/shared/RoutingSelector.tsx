/**
 * RoutingSelector component
 * Popover-based dropdown for pinning a model to a specific upstream inference
 * provider (OpenRouter-style provider routing) when routed through the Kilo Gateway.
 *
 * RoutingSelectorBase — reusable core that accepts endpoints/value/onSelect props.
 * RoutingSelector     — thin wrapper wired to session + config for chat usage.
 */

import { type Accessor, Component, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { useConfig } from "../../context/config"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { routable } from "./model-selector-utils"
import { fmtPrice } from "./model-preview-utils"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { endpointsEntry, requestEndpoints } from "../../context/routing-endpoints"
import { modelRouting } from "../../../../src/shared/provider-routing"
import type { ModelEndpoint, ModelSelection } from "../../types/messages"

// ---------------------------------------------------------------------------
// Endpoint access (shared store in ../../context/routing-endpoints)
// ---------------------------------------------------------------------------

export function useModelEndpoints(model: Accessor<ModelSelection | undefined>) {
  const vscode = useVSCode()

  function load() {
    const selection = model()
    if (!selection) return
    requestEndpoints(selection.providerID, selection.modelID, vscode.postMessage)
  }

  // undefined while unrequested/loading; [] for a failed request (the base
  // component renders the unavailable note and the next open retries).
  function endpoints() {
    const selection = model()
    if (!selection) return undefined
    const entry = endpointsEntry(selection.providerID, selection.modelID)
    if (!entry) return undefined
    return entry.status === "ok" ? entry.endpoints : []
  }

  return { endpoints, load }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export { routable }
export { modelRouting, routingPartial } from "../../../../src/shared/provider-routing"

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(n)
}

function fmtUptime(n: number): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

interface RoutingPreviewProps {
  endpoint: ModelEndpoint | undefined
  auto: boolean
  autoLabel: string
  /** The previewed endpoint is pinned but no longer present in the catalog. */
  unavailable: boolean
}

const RoutingPreview: Component<RoutingPreviewProps> = (props) => {
  const language = useLanguage()

  return (
    <div class="model-preview">
      <Show
        when={props.endpoint}
        keyed
        fallback={
          <>
            <div class="model-preview-header">
              <span class="model-preview-name">{props.autoLabel}</span>
            </div>
            <div class="model-preview-description">{language.t("model.routing.preview.autoDescription")}</div>
          </>
        }
      >
        {(endpoint) => (
          <>
            <div class="model-preview-header">
              <span class="model-preview-name">
                {props.auto ? `${props.autoLabel} (${endpoint.provider})` : endpoint.name}
              </span>
              <span class="model-preview-provider">{props.auto ? endpoint.name : endpoint.provider}</span>
            </div>
            <Show when={props.unavailable}>
              <div class="model-preview-description">{language.t("model.routing.unavailable")}</div>
            </Show>
            <div class="model-preview-grid">
              <Show when={endpoint.quantization} keyed>
                {(value) => (
                  <>
                    <span class="model-preview-label">{language.t("model.routing.preview.quantization")}</span>
                    <span class="model-preview-value">{value}</span>
                  </>
                )}
              </Show>
              <Show when={endpoint.context !== undefined}>
                <span class="model-preview-label">{language.t("model.preview.label.context")}</span>
                <span class="model-preview-value">{fmtContext(endpoint.context ?? 0)}</span>
              </Show>
              <Show when={endpoint.output !== undefined}>
                <span class="model-preview-label">{language.t("model.routing.preview.maxOutput")}</span>
                <span class="model-preview-value">{fmtContext(endpoint.output ?? 0)}</span>
              </Show>
              <Show when={endpoint.pricing?.input !== undefined}>
                <span class="model-preview-label">{language.t("model.preview.label.input")}</span>
                <span class="model-preview-value">{fmtPrice(endpoint.pricing?.input ?? 0)}</span>
              </Show>
              <Show when={endpoint.pricing?.output !== undefined}>
                <span class="model-preview-label">{language.t("model.preview.label.output")}</span>
                <span class="model-preview-value">{fmtPrice(endpoint.pricing?.output ?? 0)}</span>
              </Show>
              <Show when={endpoint.pricing?.cacheRead !== undefined}>
                <span class="model-preview-label">{language.t("model.routing.preview.cacheRead")}</span>
                <span class="model-preview-value">{fmtPrice(endpoint.pricing?.cacheRead ?? 0)}</span>
              </Show>
              <Show when={endpoint.pricing?.cacheWrite !== undefined}>
                <span class="model-preview-label">{language.t("model.routing.preview.cacheWrite")}</span>
                <span class="model-preview-value">{fmtPrice(endpoint.pricing?.cacheWrite ?? 0)}</span>
              </Show>
              <Show when={endpoint.uptime !== undefined}>
                <span class="model-preview-label">{language.t("model.routing.preview.uptime")}</span>
                <span class="model-preview-value">{fmtUptime(endpoint.uptime ?? 0)}</span>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reusable base component
// ---------------------------------------------------------------------------

export interface RoutingSelectorBaseProps {
  /** Available endpoints for the model; undefined while loading */
  endpoints: ModelEndpoint[] | undefined
  /** Currently pinned routing slug (e.g. "gmicloud/fp8") */
  value: string | undefined
  /** Called when the user pins an endpoint */
  onSelect: (provider: string) => void
  /** Called when the user picks the automatic-routing row */
  onClear: () => void
  /** Called when the popover opens — used to lazily load endpoints */
  onOpen?: () => void
  /** Popover placement — defaults to top-start. */
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end"
  /** Render inline instead of through a portal when nested in a dialog. */
  portal?: boolean
}

export const RoutingSelectorBase: Component<RoutingSelectorBaseProps> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(-1)
  const [moved, setMoved] = createSignal(false)
  let listRef: HTMLDivElement | undefined

  const auto = () => language.t("model.routing.auto")
  // A pinned slug that vanished from the catalog still renders as a synthetic
  // row, so the active pin stays visible and clearable instead of silently
  // presenting as Auto.
  const missing = createMemo<ModelEndpoint | undefined>(() => {
    const value = props.value
    if (!value || !props.endpoints) return undefined
    if (props.endpoints.some((endpoint) => endpoint.provider === value)) return undefined
    return { provider: value, name: value }
  })
  const rows = (): (ModelEndpoint | undefined)[] => {
    const gone = missing()
    return [undefined, ...(gone ? [gone] : []), ...(props.endpoints ?? [])]
  }
  // While the popover is open focus always sits on a row (see onOpen), so
  // hovered() is undefined exactly when the Auto row is active. Previewing
  // Auto with a pin still in place intentionally falls back to the pinned
  // endpoint's data as a reference point — the "Auto (slug)" header marks
  // that state; it is not a claim the gateway will pick that endpoint.
  const hovered = () => rows()[focused()]
  const pinned = () => props.endpoints?.find((endpoint) => endpoint.provider === props.value) ?? missing()
  const preview = () => hovered() ?? pinned()
  const previewingAuto = () => hovered() === undefined
  const unavailable = () => preview() !== undefined && preview() === missing()

  function focusItem(idx: number) {
    setMoved(true)
    const items = listRef?.querySelectorAll<HTMLElement>("[role=option]")
    if (!items) return
    const clamped = Math.max(0, Math.min(idx, items.length - 1))
    setFocused(clamped)
    items[clamped]?.focus()
  }

  // After a cold-cache load completes while the popover is open, move focus to
  // the pinned row once — unless the user already navigated somewhere.
  createEffect(() => {
    if (!open() || moved()) return
    const idx = rows().findIndex((row) => row?.provider === props.value)
    if (idx > 0 && idx !== focused()) focusItem(idx)
  })

  function refocus() {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  }

  function onOpen(val: boolean) {
    if (val) {
      props.onOpen?.()
      const idx = rows().findIndex((row) => row?.provider === props.value)
      setFocused(idx >= 0 ? idx : 0)
      setMoved(false)
      setOpen(true)
      return
    }
    setOpen(false)
    refocus()
  }

  function pick(row: ModelEndpoint | undefined) {
    if (row === undefined) props.onClear()
    else props.onSelect(row.provider)
    onOpen(false)
  }

  function onKeyDown(e: KeyboardEvent) {
    const len = rows().length
    const cur = focused()
    if (len === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      focusItem((cur + 1) % len)
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      focusItem((cur - 1 + len) % len)
      return
    }
    if (e.key === "Home") {
      e.preventDefault()
      focusItem(0)
      return
    }
    if (e.key === "End") {
      e.preventDefault()
      focusItem(len - 1)
      return
    }
    if (e.key === " " || isEnterKeyCommitNotIme(e)) {
      e.preventDefault()
      if (cur >= 0 && cur < len) pick(rows()[cur])
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onOpen(false)
    }
  }

  return (
    <PopupSelector
      expanded={true}
      placement={props.placement ?? "top-start"}
      preferredExpandedWidth={400}
      preferredExpandedHeight={500}
      minHeight={260}
      portal={props.portal}
      open={open()}
      onOpenChange={onOpen}
      triggerAs={Button}
      triggerProps={{ variant: "ghost", size: "small", "aria-label": language.t("model.routing.label") }}
      trigger={
        <>
          <span class="routing-selector-trigger-label">{props.value ?? auto()}</span>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
            <path d="M8 4l4 5H4l4-5z" />
          </svg>
        </>
      }
      class="routing-selector-popover"
    >
      {(bodyH) => (
        <div class="routing-selector-body" onKeyDown={onKeyDown} style={{ height: `${bodyH()}px` }}>
          <div class="routing-selector-preview">
            <RoutingPreview
              endpoint={preview()}
              auto={previewingAuto()}
              autoLabel={auto()}
              unavailable={unavailable()}
            />
          </div>
          <div class="routing-selector-divider" />
          <div class="routing-selector-list" role="listbox" ref={listRef}>
            <For each={rows()}>
              {(row, i) => {
                const selected = () => (row?.provider ?? undefined) === props.value
                return (
                  <div
                    class={`routing-selector-item${selected() ? " selected" : ""}`}
                    role="option"
                    aria-selected={selected()}
                    tabindex={focused() === i() ? 0 : -1}
                    data-autofocus={focused() === i() ? "" : undefined}
                    onClick={() => pick(row)}
                    onFocus={() => setFocused(i())}
                    onMouseEnter={() => {
                      setMoved(true)
                      setFocused(i())
                    }}
                  >
                    <span class="routing-selector-item-name">{row?.provider ?? auto()}</span>
                    <Show when={row !== undefined && row === missing()}>
                      <span class="routing-selector-item-unavailable">{language.t("model.routing.unavailable")}</span>
                    </Show>
                  </div>
                )
              }}
            </For>
            <Show when={props.endpoints === undefined}>
              <div class="routing-selector-note">{language.t("model.routing.loading")}</div>
            </Show>
            <Show when={props.endpoints?.length === 0}>
              <div class="routing-selector-note">{language.t("model.routing.empty")}</div>
            </Show>
          </div>
        </div>
      )}
    </PopupSelector>
  )
}

// ---------------------------------------------------------------------------
// Chat-specific wrapper
// ---------------------------------------------------------------------------

interface RoutingSelectorProps {
  sessionID?: Accessor<string | undefined>
}

export const RoutingSelector: Component<RoutingSelectorProps> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const { config } = useConfig()
  const id = () => props.sessionID?.()

  const routed = () => {
    const model = session.selected(id())
    if (!model || !routable(model.providerID, model.modelID)) return undefined
    return model
  }
  const endpoints = useModelEndpoints(routed)

  function persist(model: ModelSelection, provider: string | null) {
    vscode.postMessage({
      type: "persistModelRouting",
      providerID: model.providerID,
      modelID: model.modelID,
      provider,
    })
  }

  return (
    <Show when={routed()}>
      {(model) => (
        <RoutingSelectorBase
          endpoints={endpoints.endpoints()}
          value={modelRouting(config(), model().providerID, model().modelID)}
          onSelect={(provider) => persist(model(), provider)}
          onClear={() => persist(model(), null)}
          onOpen={endpoints.load}
        />
      )}
    </Show>
  )
}
