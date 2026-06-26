import { For, Show, createMemo } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"
import type { StackPlanAction, StackPlanStatus } from "../../types/stack"

type Group = "install" | "remove" | "preserve" | "blocked"

function group(status: StackPlanStatus): Group {
  if (status === "install") return "install"
  if (status === "remove") return "remove"
  if (status === "blocked" || status === "missing") return "blocked"
  return "preserve"
}

function ActionCard(props: { action: StackPlanAction }) {
  const stack = useStack()
  const language = useLanguage()
  const summary = () =>
    stack.data()?.catalog.resources.find((item) => item.resource.ref === props.action.resource)
  const resource = () => summary()?.resource
  const description = () => summary()?.item?.description
  const tone = () => {
    const current = group(props.action.action)
    if (current === "blocked") return "error" as const
    if (current === "remove") return "warning" as const
    return "normal" as const
  }
  const technologies = () => {
    const catalog = stack.data()?.catalog.catalog
    return props.action.technologies.map(
      (id) =>
        catalog?.verticals.flatMap((vertical) => vertical.technologies).find((technology) => technology.id === id)
          ?.name ?? id,
    )
  }

  return (
    <Card class="stack-action-card" variant={tone()}>
      <div class="stack-action-heading">
        <div>
          <CardTitle icon={resource()?.kind === "mcp" ? "mcp" : "brain"}>
            {resource()?.name ?? props.action.resource}
          </CardTitle>
          <code class="stack-action-key">{props.action.resource}</code>
        </div>
        <div class="stack-resource-tags">
          <Tag>{language.t(`stack.action.${props.action.action}`)}</Tag>
          <Show when={resource()?.trust}>{(trust) => <Tag>{trust()}</Tag>}</Show>
          <Show when={resource()?.maturity}>{(maturity) => <Tag>{maturity()}</Tag>}</Show>
        </div>
      </div>
      <Show when={description()}>
        {(item) => <CardDescription>{item()}</CardDescription>}
      </Show>
      <Show when={technologies().length > 0}>
        <p class="stack-action-tech">
          {language.t("stack.review.usedBy", { technologies: technologies().join(", ") })}
        </p>
      </Show>
      <Show when={resource()?.kind === "mcp" && props.action.action === "install"}>
        <p class="stack-auth-line">{language.t("stack.resource.mcpFollowUp")}</p>
      </Show>
      <Show when={resource()?.source}>
        {(source) => (
          <Button
            variant="ghost"
            size="small"
            icon="open-file"
            onClick={() => stack.openExternal(source())}
            disabled={!stack.editable()}
          >
            {language.t("stack.resource.source")}
          </Button>
        )}
      </Show>
    </Card>
  )
}

export function ReviewStep() {
  const stack = useStack()
  const language = useLanguage()
  const groups = createMemo(() => {
    const actions = stack.plan()?.actions ?? []
    return {
      install: actions.filter((action) => group(action.action) === "install"),
      remove: actions.filter((action) => group(action.action) === "remove"),
      preserve: actions.filter((action) => group(action.action) === "preserve"),
      blocked: actions.filter((action) => group(action.action) === "blocked"),
    }
  })
  const drift = () => stack.data()?.state.resources.filter((resource) => resource.drift !== "none") ?? []
  const name = (ref: string) =>
    stack.data()?.catalog.resources.find((summary) => summary.resource.ref === ref)?.resource.name ?? ref

  return (
    <section class="stack-step" aria-labelledby="stack-review-title">
      <div class="stack-step-heading">
        <span class="stack-kicker">{language.t("stack.review.kicker")}</span>
        <h2 id="stack-review-title" tabIndex={-1}>
          {language.t("stack.review.title")}
        </h2>
        <p>{language.t("stack.review.description")}</p>
      </div>
      <Show when={stack.stale()}>
        <Card variant="warning" class="stack-stale" role="alert">
          <CardTitle variant="warning">{language.t("stack.stale.title")}</CardTitle>
          <CardDescription>{language.t("stack.stale.description")}</CardDescription>
          <Button variant="secondary" onClick={stack.preview} disabled={!stack.editable()}>
            {language.t("stack.stale.refresh")}
          </Button>
        </Card>
      </Show>
      <For each={drift()}>
        {(resource) => (
          <Card variant="warning" class="stack-drift">
            <CardTitle variant="warning">{language.t("stack.review.drift")}</CardTitle>
            <CardDescription>
              {language.t(`stack.drift.${resource.drift}`, { resource: name(resource.resource) })}
            </CardDescription>
          </Card>
        )}
      </For>
      <Show when={(stack.plan()?.conflicts.length ?? 0) > 0}>
        <Card variant="error" class="stack-review-notice">
          <CardTitle variant="error">{language.t("stack.review.conflicts")}</CardTitle>
          <For each={stack.plan()?.conflicts ?? []}>
            {(conflict) => (
              <p>
                <Show when={conflict.resource}>{(resource) => <code class="stack-action-key">{resource()}</code>}</Show>{" "}
                {conflict.message}
              </p>
            )}
          </For>
        </Card>
      </Show>
      <Show when={(stack.plan()?.warnings.length ?? 0) > 0}>
        <Card variant="warning" class="stack-review-notice">
          <CardTitle variant="warning">{language.t("stack.review.warnings")}</CardTitle>
          <For each={stack.plan()?.warnings ?? []}>{(warning) => <p>{warning}</p>}</For>
        </Card>
      </Show>
      <Show when={(stack.plan()?.prerequisites.length ?? 0) > 0}>
        <Card variant="info" class="stack-review-notice">
          <CardTitle variant="info">{language.t("stack.resource.prerequisites")}</CardTitle>
          <For each={stack.plan()?.prerequisites ?? []}>{(item) => <p>{item}</p>}</For>
        </Card>
      </Show>
      <For each={["install", "remove", "preserve", "blocked"] as Group[]}>
        {(groupName) => (
          <Show when={groups()[groupName].length > 0}>
            <section
              class="stack-review-group"
              role={groupName === "blocked" ? "alert" : undefined}
              aria-live={groupName === "blocked" ? "assertive" : undefined}
            >
              <div class="stack-resource-group-title">
                <div>
                  <h3>{language.t(`stack.review.group.${groupName}`)}</h3>
                  <p class="stack-muted">{language.t(`stack.review.group.${groupName}Description`)}</p>
                </div>
                <Tag>{groups()[groupName].length}</Tag>
              </div>
              <div class="stack-resource-list">
                <For each={groups()[groupName]}>{(action) => <ActionCard action={action} />}</For>
              </div>
            </section>
          </Show>
        )}
      </For>
      <Show when={(stack.plan()?.actions.length ?? 0) === 0}>
        <Card class="stack-inline-empty">
          <CardTitle icon="circle-check">{language.t("stack.review.noChangesTitle")}</CardTitle>
          <CardDescription>{language.t("stack.review.noChangesDescription")}</CardDescription>
        </Card>
      </Show>
      <Show when={stack.plan()?.plan_hash}>
        {(hash) => (
          <div class="stack-plan-hash">
            <span>{language.t("stack.review.planHash")}</span>
            <code>{hash()}</code>
          </div>
        )}
      </Show>
    </section>
  )
}
