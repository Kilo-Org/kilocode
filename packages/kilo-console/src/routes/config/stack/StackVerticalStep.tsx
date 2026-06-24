import { For, Show } from "solid-js"
import { Card } from "@kilocode/kilo-web-ui/card"
import { ConfigTag } from "../ConfigPage"
import type { StackWizard } from "../state/stack"

export function StackVerticalStep(props: { state: StackWizard }) {
  const drift = () => props.state.saved()?.resources.filter((item) => item.drift !== "none") ?? []

  return (
    <section class="stack-step" aria-labelledby="stack-vertical-title">
      <div class="stack-step-heading">
        <p class="eyebrow">Project stack</p>
        <h2 id="stack-vertical-title" data-stack-focus tabIndex={-1}>
          Choose a technology vertical
        </h2>
        <p>The available verticals and technologies come directly from the project Stack catalog.</p>
      </div>

      <Show when={!props.state.ready()}>
        <Card class="stack-drift" variant="warning">
          <strong>Marketplace coverage incomplete</strong>
          <p>
            {props.state.gaps()
              ? `${props.state.gaps()} expected Marketplace resources are unavailable. You can continue with available resources; unavailable resources cannot be enabled or applied.`
              : "The expected Marketplace coverage manifest is empty. You can continue, but unavailable resources cannot be enabled or applied."}
          </p>
        </Card>
      </Show>

      <Show when={drift().length || props.state.saved()?.conflicts.length}>
        <Card class="stack-drift" variant="warning">
          <strong>Pending project drift or conflicts</strong>
          <p>Direct Stack config or managed resource changes require a new review.</p>
          <ul>
            <For each={drift()}>
              {(item) => (
                <li>
                  {item.resource}: {item.drift}
                </li>
              )}
            </For>
            <For each={props.state.saved()?.conflicts}>{(item) => <li>{item.message}</li>}</For>
          </ul>
        </Card>
      </Show>

      <div class="stack-verticals">
        <For each={props.state.catalog()?.catalog.verticals}>
          {(item) => (
            <button
              class="stack-vertical-card"
              classList={{ selected: props.state.vertical() === item.id }}
              type="button"
              aria-pressed={props.state.vertical() === item.id}
              onClick={() => props.state.choose(item.id)}
            >
              <span class="stack-vertical-mark" aria-hidden="true">
                {item.name.slice(0, 2).toUpperCase()}
              </span>
              <span class="stack-vertical-copy">
                <strong>{item.name}</strong>
                <small>
                  {item.technologies.length} technologies across {item.categories.length} catalog groups
                </small>
              </span>
              <ConfigTag tone={props.state.ready() ? "success" : "warning"}>
                {props.state.gaps()} Marketplace gaps
              </ConfigTag>
            </button>
          )}
        </For>
      </div>

      <p class="stack-revision mono">Catalog revision {props.state.catalog()?.catalog.revision}</p>
    </section>
  )
}
