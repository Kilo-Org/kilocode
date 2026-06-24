import { For, Show } from "solid-js"
import { stackTechnologySelected, type StackWizard } from "../state/stack"

export function StackRail(props: { state: StackWizard }) {
  const phase = () => props.state.phase()
  const atCategory = () => phase() === "category"
  const done = () => phase() === "result"
  const selectedCount = (index: number) => {
    const entry = props.state.categories()[index]
    if (!entry) return 0
    const ids = new Set(entry.groups.flatMap((group) => group.technologies.map((item) => item.technology)))
    return [...ids].filter((id) => stackTechnologySelected(props.state.draft(), props.state.vertical(), id)).length
  }

  return (
    <aside class="stack-rail" aria-label="Stack setup steps">
      <div class="stack-rail-section">
        <span class="stack-rail-index">01</span>
        <button
          class="stack-rail-label"
          classList={{ active: phase() === "vertical" }}
          type="button"
          aria-current={phase() === "vertical" ? "step" : undefined}
          onClick={() => props.state.goVertical()}
          disabled={done()}
        >
          Vertical
        </button>
      </div>
      <div class="stack-rail-section">
        <span class="stack-rail-index">02</span>
        <span class="stack-rail-heading" classList={{ active: atCategory() }}>
          Technologies
        </span>
        <Show when={props.state.categories().length > 0}>
          <div class="stack-rail-nav">
            <For each={props.state.categories()}>
              {(entry, index) => (
                <button
                  class="stack-rail-item"
                  classList={{ active: atCategory() && props.state.index() === index() }}
                  type="button"
                  aria-current={atCategory() && props.state.index() === index() ? "step" : undefined}
                  onClick={() => props.state.goCategory(index())}
                  disabled={done()}
                >
                  <span>{entry.category.name}</span>
                  <span>{selectedCount(index())}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="stack-rail-section">
        <span class="stack-rail-index">03</span>
        <button
          class="stack-rail-label"
          classList={{ active: phase() === "resources" }}
          type="button"
          aria-current={phase() === "resources" ? "step" : undefined}
          onClick={() => props.state.goResources()}
          disabled={done()}
        >
          Resources
        </button>
      </div>
      <div class="stack-rail-section">
        <span class="stack-rail-index">04</span>
        <button
          class="stack-rail-label"
          classList={{ active: phase() === "review" }}
          type="button"
          aria-current={phase() === "review" ? "step" : undefined}
          onClick={() => void props.state.review()}
          disabled={done()}
        >
          Review
        </button>
      </div>
      <Show when={done()}>
        <div class="stack-rail-section">
          <span class="stack-rail-index">05</span>
          <span class="stack-rail-label active">Result</span>
        </div>
      </Show>
    </aside>
  )
}
