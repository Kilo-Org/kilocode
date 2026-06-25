import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"
import { flattenCategories } from "../../context/stack-state"

export function VerticalStep() {
  const stack = useStack()
  const language = useLanguage()
  const verticals = () => stack.data()?.catalog.catalog.verticals ?? []
  const drift = () => stack.data()?.state.resources.filter((resource) => resource.drift !== "none") ?? []
  const name = (ref: string) =>
    stack.data()?.catalog.resources.find((summary) => summary.resource.ref === ref)?.resource.name ?? ref

  return (
    <section class="stack-step" aria-labelledby="stack-vertical-title">
      <div class="stack-step-heading">
        <span class="stack-kicker">{language.t("stack.vertical.kicker")}</span>
        <h2 id="stack-vertical-title" tabIndex={-1}>
          {language.t("stack.vertical.title")}
        </h2>
        <p>{language.t("stack.vertical.description")}</p>
      </div>
      <Show when={!stack.ready()}>
        <Card variant="warning" class="stack-drift" role="status">
          <CardTitle variant="warning">{language.t("stack.readiness.title")}</CardTitle>
          <CardDescription>
            {language.t(stack.gaps() ? "stack.readiness.description" : "stack.readiness.emptyDescription", {
              count: stack.gaps(),
            })}
          </CardDescription>
        </Card>
      </Show>
      <Show when={drift().length > 0}>
        <Card variant="warning" class="stack-drift">
          <CardTitle variant="warning">{language.t("stack.review.drift")}</CardTitle>
          <CardDescription>{language.t("stack.review.driftDescription")}</CardDescription>
          <For each={drift()}>
            {(resource) => (
              <p class="stack-warning-line">
                {language.t(`stack.drift.${resource.drift}`, { resource: name(resource.resource) })}
              </p>
            )}
          </For>
        </Card>
      </Show>
      <div class="stack-vertical-grid">
        <For each={verticals()}>
          {(vertical) => (
            <Button
              class="stack-vertical-card"
              data-active={stack.verticalID() === vertical.id || undefined}
              disabled={!stack.editable()}
              onClick={() => stack.chooseVertical(vertical.id)}
              aria-pressed={stack.verticalID() === vertical.id}
            >
              <Card>
                <CardTitle icon="status">{vertical.name}</CardTitle>
                <CardDescription>{language.t("stack.vertical.fallback")}</CardDescription>
                <div class="stack-card-meta">
                  <Tag>
                    {language.t("stack.vertical.categoryCount", {
                      count: flattenCategories(vertical.categories).length,
                    })}
                  </Tag>
                  <Show when={!stack.ready()}>
                    <Tag>{language.t("stack.vertical.comingSoon", { count: stack.gaps() })}</Tag>
                  </Show>
                </div>
              </Card>
            </Button>
          )}
        </For>
      </div>
      <div class="stack-redetect">
        <Button variant="secondary" disabled={!stack.editable()} onClick={() => stack.detect()}>
          {language.t("stack.action.redetect")}
        </Button>
      </div>
      <p class="stack-revision">
        {language.t("stack.vertical.revision", { revision: stack.data()?.catalog.catalog.revision ?? "" })}
      </p>
    </section>
  )
}
