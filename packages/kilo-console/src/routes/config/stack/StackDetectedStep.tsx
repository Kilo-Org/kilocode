import { createMemo, For, Show } from "solid-js"
import { ConfigTag } from "../ConfigPage"
import { stackTechnologySelected, type StackWizard } from "../state/stack"
import { TechnologyIcon } from "./TechnologyIcon"

export function StackDetectedStep(props: { state: StackWizard }) {
  const names = createMemo(() => {
    const map = new Map<string, string>()
    for (const vertical of props.state.catalog()?.catalog.verticals ?? []) {
      for (const technology of vertical.technologies) map.set(technology.id, technology.name)
    }
    return map
  })

  const groups = createMemo(() => {
    const byVertical = new Map<string, { technology: string; evidence: string }[]>()
    for (const detection of props.state.detections()) {
      const list = byVertical.get(detection.vertical) ?? []
      list.push({ technology: detection.technology, evidence: detection.evidence })
      byVertical.set(detection.vertical, list)
    }
    const verticalName = new Map(
      (props.state.catalog()?.catalog.verticals ?? []).map((vertical) => [vertical.id, vertical.name]),
    )
    return [...byVertical.entries()].map(([vertical, items]) => ({
      vertical,
      name: verticalName.get(vertical) ?? vertical,
      items: items.toSorted((a, b) => a.technology.localeCompare(b.technology)),
    }))
  })

  const selected = createMemo(() => {
    const draft = props.state.draft()
    let count = 0
    for (const detection of props.state.detections()) {
      if (stackTechnologySelected(draft, detection.vertical, detection.technology)) count += 1
    }
    return count
  })

  return (
    <section class="stack-step" aria-labelledby="stack-detected-title">
      <div class="stack-step-heading stack-category-heading">
        <div>
          <p class="eyebrow">Auto-detected</p>
          <h2 id="stack-detected-title" data-stack-focus tabIndex={-1}>
            Detected technologies
          </h2>
          <p>
            These technologies were found in this project. Deselect any false positives, then continue to review
            managed resources. Missed one? Choose{" "}
            <em>Select manually</em> to pick it by hand.
          </p>
        </div>
        <ConfigTag tone={selected() ? "brand" : "neutral"}>{selected()} selected</ConfigTag>
      </div>

      <Show
        when={props.state.detections().length > 0}
        fallback={<p class="stack-empty">No technologies were detected. Select manually to choose your stack.</p>}
      >
        <For each={groups()}>
          {(group) => (
            <div class="stack-detected-vertical">
              <h3 class="stack-subcategory">{group.name}</h3>
              <div class="stack-technologies" role="group" aria-label={group.name}>
                <For each={group.items}>
                  {(item) => {
                    const checked = () =>
                      stackTechnologySelected(props.state.draft(), group.vertical, item.technology)
                    return (
                      <button
                        class="stack-technology-card"
                        classList={{ selected: checked() }}
                        type="button"
                        role="checkbox"
                        aria-checked={checked()}
                        onClick={() => props.state.toggleDetection(group.vertical, item.technology)}
                      >
                        <TechnologyIcon id={item.technology} />
                        <span class="stack-technology-copy">
                          <strong>{names().get(item.technology) ?? item.technology}</strong>
                          <small>{item.evidence}</small>
                        </span>
                        <span class="stack-check" aria-hidden="true" />
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  )
}
