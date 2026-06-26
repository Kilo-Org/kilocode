import { createMemo, For, Show } from "solid-js"
import { Card } from "@kilocode/kilo-web-ui/card"
import { ConfigTag } from "../ConfigPage"
import { groupStackPlan, type StackWizard } from "../state/stack"
import type { StackPlanAction } from "./types"

const sections = [
  { id: "install", title: "Install", description: "New managed project resources.", tone: "success" as const },
  {
    id: "remove",
    title: "Remove",
    description: "Unchanged resources previously installed by this wizard.",
    tone: "warning" as const,
  },
  {
    id: "preserve",
    title: "Preserve / unmanaged",
    description: "Existing or modified resources that remain untouched.",
    tone: "neutral" as const,
  },
  {
    id: "blocked",
    title: "Blocked",
    description: "Resolve these items before confirmation.",
    tone: "critical" as const,
  },
] as const

function technologyNames(state: StackWizard, item: StackPlanAction) {
  const technologies = state.catalog()?.catalog.verticals.flatMap((vertical) => vertical.technologies) ?? []
  return item.technologies.map((id) => technologies.find((technology) => technology.id === id)?.name ?? id)
}

function ActionCard(props: { state: StackWizard; item: StackPlanAction }) {
  const summary = () => props.state.catalog()?.resources.find((item) => item.resource.ref === props.item.resource)
  const resource = () => props.state.catalog()?.catalog.resources.find((item) => item.ref === props.item.resource)
  const description = () => summary()?.item?.description

  return (
    <Card class="stack-action-card" padding={0}>
      <div class="stack-action-main">
        <div>
          <strong>{resource()?.name ?? props.item.resource}</strong>
          <code>{props.item.resource}</code>
        </div>
        <div class="stack-resource-tags">
          <Show when={resource()}>
            {(item) => (
              <>
                <ConfigTag tone="neutral">{item().kind.toUpperCase()}</ConfigTag>
                <ConfigTag tone="neutral">{item().trust}</ConfigTag>
                <ConfigTag tone="neutral">{item().maturity}</ConfigTag>
              </>
            )}
          </Show>
        </div>
      </div>
      <Show when={description()}>{(item) => <p class="stack-resource-description">{item()}</p>}</Show>
      <Show when={props.item.technologies.length}>
        <p class="stack-action-tech">Used by {technologyNames(props.state, props.item).join(", ")}</p>
      </Show>
      <Show when={resource()?.kind === "mcp" && props.item.action === "install"}>
        <p class="stack-action-followup">
          Enabled automatically; complete any required authentication after installation.
        </p>
      </Show>
      <Show when={resource()?.source}>
        {(source) => (
          <a class="stack-source" href={source()} target="_blank" rel="noreferrer">
            View source
          </a>
        )}
      </Show>
    </Card>
  )
}

export function StackReviewStep(props: { state: StackWizard }) {
  const groups = createMemo(() => groupStackPlan(props.state.plan()?.actions ?? []))

  return (
    <section class="stack-step" aria-labelledby="stack-review-title">
      <div class="stack-step-heading">
        <p class="eyebrow">Write boundary</p>
        <h2 id="stack-review-title" data-stack-focus tabIndex={-1}>
          Review the project changes
        </h2>
        <p>Nothing has been written yet. Confirmation applies only this exact, transactionally generated plan.</p>
      </div>

      <Show when={props.state.plan()?.conflicts.length}>
        <Card class="stack-review-notice" variant="error">
          <strong>Plan conflicts</strong>
          <ul>
            <For each={props.state.plan()?.conflicts}>
              {(item) => (
                <li>
                  {item.message}
                  <Show when={item.resource}>{(resource) => ` (${resource()})`}</Show>
                </li>
              )}
            </For>
          </ul>
        </Card>
      </Show>

      <Show when={props.state.plan()?.warnings.length}>
        <Card class="stack-review-notice" variant="warning">
          <strong>Plan warnings</strong>
          <ul>
            <For each={props.state.plan()?.warnings}>{(item) => <li>{item}</li>}</For>
          </ul>
        </Card>
      </Show>

      <Show when={props.state.plan()?.prerequisites.length}>
        <Card class="stack-review-notice" variant="info">
          <strong>Prerequisites</strong>
          <ul>
            <For each={props.state.plan()?.prerequisites}>{(item) => <li>{item}</li>}</For>
          </ul>
        </Card>
      </Show>

      <div class="stack-review-groups">
        <For each={sections}>
          {(section) => {
            const actions = () => groups()[section.id]
            return (
              <section
                class="stack-review-group"
                classList={{ blocked: section.id === "blocked" && actions().length > 0 }}
              >
                <header>
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.description}</p>
                  </div>
                  <ConfigTag tone={section.tone}>{actions().length}</ConfigTag>
                </header>
                <Show when={actions().length} fallback={<p class="stack-review-empty">No actions in this group.</p>}>
                  <div class="stack-action-list">
                    <For each={actions()}>{(item) => <ActionCard state={props.state} item={item} />}</For>
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </div>

      <div class="stack-plan-hash">
        <span>Exact plan hash</span>
        <code>{props.state.plan()?.plan_hash}</code>
      </div>
    </section>
  )
}
