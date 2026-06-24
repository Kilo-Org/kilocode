import { For, Show, onMount } from "solid-js"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"

export function StackLoading() {
  const language = useLanguage()
  return (
    <div class="stack-state" role="status" aria-live="polite">
      <Spinner />
      <h2>{language.t("stack.loading.title")}</h2>
      <p>{language.t("stack.loading.description")}</p>
    </div>
  )
}

export function StackProjectRequired() {
  const language = useLanguage()
  let heading!: HTMLHeadingElement

  onMount(() => queueMicrotask(() => heading.focus()))

  return (
    <section class="stack-state" role="alert" aria-live="assertive" aria-labelledby="stack-project-required-title">
      <Card variant="info">
        <CardTitle variant="info">
          <h2 id="stack-project-required-title" tabIndex={-1} ref={heading}>
            {language.t("stack.projectRequired.title")}
          </h2>
        </CardTitle>
        <CardDescription>{language.t("stack.projectRequired.description")}</CardDescription>
      </Card>
    </section>
  )
}

export function StackResult() {
  const stack = useStack()
  const language = useLanguage()
  const result = () => stack.result()
  const failure = () => stack.failure()
  const actions = () => result()?.results ?? failure()?.results ?? []
  const failed = () => !!failure() || actions().some((action) => !action.success)
  const name = (ref: string) =>
    stack.data()?.catalog.resources.find((summary) => summary.resource.ref === ref)?.resource.name ?? ref

  return (
    <section class="stack-step" aria-labelledby="stack-result-title" aria-live="polite">
      <div class="stack-step-heading">
        <span class="stack-kicker">{language.t("stack.result.kicker")}</span>
        <h2 id="stack-result-title" tabIndex={-1}>
          {language.t(failed() ? "stack.result.failedTitle" : "stack.result.title")}
        </h2>
        <p>{language.t(failed() ? "stack.result.failedDescription" : "stack.result.description")}</p>
      </div>
      <Show when={failure()}>
        {(detail) => (
          <Card variant="error" class="stack-review-notice" role="alert">
            <CardTitle variant="error">{detail().message}</CardTitle>
            <CardDescription>
              {language.t(detail().rollback ? "stack.result.rollbackSucceeded" : "stack.result.rollbackFailed")}
            </CardDescription>
          </Card>
        )}
      </Show>
      <Show when={stack.refreshError()}>
        {(message) => (
          <Card variant="warning" class="stack-review-notice" role="alert">
            <CardTitle variant="warning">{language.t("stack.result.refreshFailed")}</CardTitle>
            <CardDescription>{message()}</CardDescription>
          </Card>
        )}
      </Show>
      <div class="stack-resource-list">
        <For each={actions()}>
          {(action) => (
            <Card variant={action.success ? "success" : "error"} role={action.success ? undefined : "alert"}>
              <div class="stack-action-heading">
                <div>
                  <CardTitle variant={action.success ? "success" : "error"}>{name(action.resource)}</CardTitle>
                  <code class="stack-action-key">{action.resource}</code>
                </div>
                <div class="stack-resource-tags">
                  <Tag>{language.t(`stack.action.${action.action}`)}</Tag>
                  <Tag>{language.t(action.success ? "stack.result.status.success" : "stack.result.status.failed")}</Tag>
                </div>
              </div>
              <Show when={action.message}>{(message) => <CardDescription>{message()}</CardDescription>}</Show>
            </Card>
          )}
        </For>
      </div>
    </section>
  )
}
