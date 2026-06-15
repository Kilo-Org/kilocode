import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import type { Model } from "@kilocode/sdk/v2/client"
import { SearchField } from "../../components/SearchField"
import { text } from "../../shared/utils"
import { ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import { type Capability, type ModelField, useModelSettings } from "./state/models"

function money(n: number) {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function fmtContext(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(n)
}

function fmtDate(s: string) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" })
}

function title(input: string) {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

function desc(model: Model) {
  const value = model.options?.description
  if (typeof value === "string" && value.trim()) return value
  return null
}

function chips(model: Model) {
  const list: string[] = []
  if (model.capabilities.toolcall) list.push("toolcall")
  if (model.capabilities.attachment) list.push("attachment")
  if (model.capabilities.input.image) list.push("vision")
  if (model.capabilities.input.audio || model.capabilities.output.audio) list.push("audio")
  return list
}

function step(max: number) {
  if (max >= 1_000_000) return 50_000
  if (max >= 100_000) return 10_000
  return 1_000
}

const slots = [
  { key: "model", label: "Default model" },
  { key: "small_model", label: "Small model" },
] satisfies { key: ModelField; label: string }[]

function pct(value: number, max: number) {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

function snap(value: number, max: number) {
  const size = step(max)
  return Math.max(0, Math.min(max, Math.round(value / size) * size))
}

function point(event: PointerEvent, root: HTMLElement, max: number) {
  const rect = root.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  return snap(ratio * max, max)
}

function Stat(props: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div class="model-stat">
      <span>{props.label}</span>
      <strong classList={{ mono: props.mono }}>
        {props.value}
        <Show when={props.sub}>{(sub) => <small>{sub()}</small>}</Show>
      </strong>
    </div>
  )
}

const caps = [
  { key: "toolcall", label: "toolcall" },
  { key: "attachment", label: "attachment" },
  { key: "input:image", label: "vision" },
  { key: "input:audio", label: "audio" },
] satisfies { key: Capability; label: string }[]

type Option = { value: string; label: string }

function FilterSelect(props: { label: string; value: string; options: Option[]; onSelect: (value: string) => void }) {
  const current = () => props.options.find((option) => option.value === props.value)?.label ?? props.value

  function choose(value: string, event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    props.onSelect(value)
    event.currentTarget.closest("details")?.removeAttribute("open")
  }

  function toggle(event: Event & { currentTarget: HTMLDetailsElement }) {
    if (!event.currentTarget.open) return
    event.currentTarget.parentElement?.querySelectorAll(".models-select[open]").forEach((node) => {
      if (node !== event.currentTarget) node.removeAttribute("open")
    })
  }

  return (
    <details class="models-select" onToggle={toggle}>
      <summary aria-label={props.label}>{current()}</summary>
      <div class="models-select-menu" role="listbox" aria-label={props.label}>
        <For each={props.options}>
          {(option) => (
            <button
              class="models-select-option"
              classList={{ selected: option.value === props.value }}
              type="button"
              role="option"
              aria-selected={option.value === props.value}
              onClick={(event) => choose(option.value, event)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </details>
  )
}

export function ModelsRoute() {
  return <ModelsDefaultRoute />
}

export function ModelsDefaultRoute() {
  const state = useModelSettings()

  return (
    <Show when={state.snap()}>
      <ConfigPage
        title="Model defaults"
        description="The models Kilo uses when an agent or command doesn't pin its own."
      >
        <div class="resolved-grid model-defaults model-default-fields">
          <For each={slots}>
            {(item) => {
              const field = () => state.snap()?.overlay.fields[item.key]
              const model = () => state.item(field()?.value)
              return (
                <article class="resolved-card default-model-card" classList={{ inherited: field()?.inherited }}>
                  <header class="default-model-header">
                    <span>{item.label}</span>
                    <div class="tags default-model-actions">
                      <SourceBadge
                        source={field()?.source}
                        inherited={field()?.inherited}
                        overridden={field()?.overridden}
                      />
                      <Show when={state.ctx.query()?.scope === "project" && field()?.overridden}>
                        <Button
                          variant="secondary"
                          disabled={Boolean(state.ctx.saving())}
                          onClick={() => state.ctx.unset([[item.key]])}
                        >
                          Revert
                        </Button>
                      </Show>
                      <IconButton
                        icon="edit"
                        variant="ghost"
                        aria-label={`Edit ${item.label}`}
                        disabled={Boolean(state.ctx.saving())}
                        onClick={() => state.edit(item.key)}
                      />
                    </div>
                  </header>
                  <div class="default-model-value">
                    <Show when={model()} fallback={<strong>{text(field()?.value)}</strong>}>
                      {(selected) => (
                        <>
                          <strong>{`${selected().provider.name} / ${selected().model.name}`}</strong>
                          <span class="default-model-id">{selected().id}</span>
                        </>
                      )}
                    </Show>
                  </div>
                </article>
              )
            }}
          </For>
        </div>

        <Show when={state.mode() !== "closed"}>
          <div class="drawer-scrim" onClick={state.close} />
          <aside class="provider-drawer" aria-label={`${state.label()} selector`}>
            <header class="drawer-header">
              <div>
                <h2>{`Choose ${state.label()}`}</h2>
                <span>Favorites are listed first, then models are sorted alphabetically.</span>
              </div>
              <Button variant="ghost" aria-label="Close model selector" onClick={state.close}>
                X
              </Button>
            </header>

            <SearchField
              class="drawer-search"
              hideLabel={false}
              label="Filter models"
              value={state.picker()}
              variant="drawer"
              placeholder="Search by name, provider, or ID"
              onValue={state.setPicker}
            />

            <div class="provider-picker model-picker">
              <Show when={state.options().length} fallback={<p class="empty">No models match this filter.</p>}>
                <For each={state.options()}>
                  {(item) => (
                    <button
                      class="provider-option model-option"
                      classList={{ selected: state.choice() === item.id }}
                      type="button"
                      onClick={() => state.select(item)}
                    >
                      <span class="model-star" classList={{ active: state.fav(item) }} aria-hidden="true" />
                      <div>
                        <strong>{item.model.name}</strong>
                        <span>{item.id}</span>
                      </div>
                      <div class="tags">
                        <Tag>{item.provider.name}</Tag>
                        <Tag>{item.model.isFree ? "free" : "paid"}</Tag>
                      </div>
                    </button>
                  )}
                </For>
              </Show>
            </div>

            <footer class="drawer-footer">
              <Button variant="ghost" onClick={state.close}>
                Cancel
              </Button>
              <Button variant="primary" disabled={Boolean(state.ctx.saving()) || !state.choice()} onClick={state.save}>
                Save
              </Button>
            </footer>
          </aside>
        </Show>
      </ConfigPage>
    </Show>
  )
}

export function ModelsAvailableRoute() {
  const state = useModelSettings()

  function drag(kind: "min" | "max", event: PointerEvent & { currentTarget: HTMLButtonElement }) {
    const root = event.currentTarget.closest(".context-range")
    if (!(root instanceof HTMLElement)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      const value = point(next, root, state.max())
      if (kind === "min") {
        state.setMin(value)
        return
      }
      state.setMax(value)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    move(event)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up, { once: true })
  }

  function key(kind: "min" | "max", event: KeyboardEvent) {
    const delta = event.key === "ArrowLeft" ? -step(state.max()) : event.key === "ArrowRight" ? step(state.max()) : 0
    if (delta === 0) return
    event.preventDefault()
    if (kind === "min") {
      state.setMin(state.low() + delta)
      return
    }
    state.setMax(state.top() + delta)
  }

  return (
    <Show when={state.snap()}>
      <ConfigPage
        title={
          <span class="config-title-count">
            Explore models
            <Tag>{state.models().length}</Tag>
          </span>
        }
        description="All models exposed by configured providers. Set defaults under Models > Defaults."
      >
        <section class="models-filter-card">
          <div class="models-filter-row models-filter-primary">
            <label class="models-filter-field models-search-field">
              <span>Search</span>
              <input
                value={state.search()}
                placeholder="Search by name or ID..."
                onInput={(event) => state.setSearch(event.currentTarget.value)}
              />
            </label>
            <FilterSelect
              label="Provider"
              value={state.filter()}
              options={[
                { value: "all", label: "All providers" },
                ...state.providers().map((provider) => ({ value: provider.id, label: provider.name })),
              ]}
              onSelect={state.setFilter}
            />
            <FilterSelect
              label="Cost"
              value={state.price()}
              options={[
                { value: "all", label: "Any cost" },
                { value: "free", label: "Free" },
                { value: "paid", label: "Paid" },
              ]}
              onSelect={state.setPrice}
            />
            <FilterSelect
              label="Reasoning"
              value={state.reason()}
              options={[
                { value: "all", label: "Reasoning · any" },
                { value: "reasoning", label: "Reasoning · yes" },
                { value: "standard", label: "Reasoning · no" },
              ]}
              onSelect={state.setReason}
            />
            <button
              class="models-favorite-filter"
              classList={{ selected: state.starred() }}
              type="button"
              aria-pressed={state.starred()}
              onClick={() => state.setStarred(!state.starred())}
            >
              <span class="model-star" classList={{ active: state.starred() }} aria-hidden="true" />
              Favorites
            </button>
          </div>

          <div class="models-filter-row models-filter-secondary">
            <div class="models-context-filter">
              <span>Context max</span>
              <div class="context-range" style={`--context-min: 0%; --context-max: ${pct(state.top(), state.max())}%;`}>
                <span class="context-track" aria-hidden="true" />
                <span class="context-fill" aria-hidden="true" />
                <button
                  class="context-max"
                  aria-label="Maximum context"
                  aria-valuemin="0"
                  aria-valuemax={state.max()}
                  aria-valuenow={state.top()}
                  disabled={state.max() === 0}
                  role="slider"
                  type="button"
                  onKeyDown={(event) => key("max", event)}
                  onPointerDown={(event) => drag("max", event)}
                />
              </div>
              <strong class="models-context-value mono">{fmtContext(state.top())}</strong>
            </div>
            <div class="models-capabilities-filter">
              <span>Capabilities</span>
              <div class="models-capabilities-list">
                <For each={caps}>
                  {(cap) => (
                    <button
                      class="models-capability-toggle"
                      classList={{ selected: state.caps().includes(cap.key) }}
                      type="button"
                      aria-pressed={state.caps().includes(cap.key)}
                      onClick={() => state.toggle(cap.key)}
                    >
                      {cap.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </section>

        <div class="models explore-models">
          <Show when={state.models().length} fallback={<p class="empty">No models match the current filters.</p>}>
            <For each={state.models()}>
              {(item) => (
                <article class="model explore-model-card">
                  <div class="model-main">
                    <div class="model-title">
                      <button
                        aria-label={state.fav(item) ? "Remove favorite" : "Add favorite"}
                        aria-pressed={state.fav(item)}
                        class="model-star"
                        classList={{ active: state.fav(item) }}
                        onClick={() => state.favorite(item)}
                        type="button"
                      />
                      <div>
                        <strong>{item.model.name}</strong>
                        <span>{item.id}</span>
                      </div>
                    </div>
                    <div class="tags model-tags">
                      <Tag tone="brand">{item.provider.id}</Tag>
                      <Tag tone={item.model.isFree ? "success" : "neutral"}>{item.model.isFree ? "free" : "paid"}</Tag>
                    </div>
                  </div>
                  <Show when={desc(item.model)}>{(value) => <p class="model-description">{value()}</p>}</Show>
                  <div class="model-info-grid">
                    <Stat label="Family" value={item.model.family ? title(item.model.family) : "Unknown"} />
                    <Stat
                      label="Released"
                      value={item.model.release_date ? fmtDate(item.model.release_date) : "Unknown"}
                    />
                    <Stat label="Context" value={fmtContext(item.model.limit.context)} mono />
                    <Stat label="Input" value={money(item.model.cost.input)} sub="/ 1M tok" mono />
                    <Stat label="Output" value={money(item.model.cost.output)} sub="/ 1M tok" mono />
                    <Stat label="Reasoning" value={item.model.capabilities.reasoning ? "Yes" : "No"} />
                  </div>
                  <Show when={chips(item.model).length}>
                    <div class="tags model-capabilities">
                      <For each={chips(item.model)}>{(cap) => <Tag>{cap}</Tag>}</For>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </Show>
        </div>
      </ConfigPage>
    </Show>
  )
}
