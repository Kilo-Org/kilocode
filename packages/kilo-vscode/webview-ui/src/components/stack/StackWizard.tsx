import { For, Show, createEffect } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { useStack } from "../../context/stack"
import { CategoryStep } from "./CategoryStep"
import { ResourceStep } from "./ResourceStep"
import { ReviewStep } from "./ReviewStep"
import { StackLoading, StackProjectRequired, StackResult } from "./StackStates"
import { VerticalStep } from "./VerticalStep"

function Rail() {
  const stack = useStack()
  const language = useLanguage()

  return (
    <aside class="stack-rail" aria-label={language.t("stack.navigation.label")}>
      <div class="stack-rail-section">
        <span class="stack-rail-index">01</span>
        <span class="stack-rail-label" data-active={stack.step() === "vertical" || undefined}>
          {language.t("stack.navigation.vertical")}
        </span>
      </div>
      <div class="stack-rail-section stack-category-nav">
        <div class="stack-rail-heading">
          <span class="stack-rail-index">02</span>
          <span>{language.t("stack.navigation.technologies")}</span>
        </div>
        <div class="stack-category-nav-list">
          <For each={stack.categories()}>
            {(entry, index) => (
              <Button
                variant="ghost"
                size="small"
                class="stack-category-nav-item"
                data-active={stack.step() === "category" && stack.category() === index() ? true : undefined}
                onClick={() => stack.goCategory(index())}
                disabled={!stack.editable()}
                aria-current={stack.step() === "category" && stack.category() === index() ? "step" : undefined}
              >
                <span>{entry.category.name}</span>
                <span>
                  {new Set(
                    entry.groups
                      .flatMap((group) => group.technologies.map((item) => item.technology))
                      .filter((item) => stack.selected().includes(item)),
                  ).size}
                </span>
              </Button>
            )}
          </For>
        </div>
      </div>
      <div class="stack-rail-section">
        <span class="stack-rail-index">03</span>
        <span class="stack-rail-label" data-active={stack.step() === "resources" || undefined}>
          {language.t("stack.navigation.resources")}
        </span>
      </div>
      <div class="stack-rail-section">
        <span class="stack-rail-index">04</span>
        <span class="stack-rail-label" data-active={stack.step() === "review" || undefined}>
          {language.t("stack.navigation.review")}
        </span>
      </div>
      <Show when={stack.step() === "result"}>
        <div class="stack-rail-section">
          <span class="stack-rail-index">05</span>
          <span class="stack-rail-label" data-active>
            {language.t("stack.navigation.result")}
          </span>
        </div>
      </Show>
    </aside>
  )
}

function Footer() {
  const stack = useStack()
  const language = useLanguage()
  const busy = () => !!stack.busy()

  return (
    <footer class="stack-footer" aria-busy={busy()}>
      <Button variant="ghost" onClick={stack.cancel} disabled={busy()}>
        {language.t(stack.step() === "result" ? "stack.action.close" : "stack.action.cancel")}
      </Button>
      <div class="stack-footer-primary">
        <Show when={stack.step() !== "vertical" && stack.step() !== "result"}>
          <Button variant="secondary" icon="arrow-left" onClick={stack.back} disabled={busy()}>
            {language.t("stack.action.back")}
          </Button>
        </Show>
        <Show when={stack.step() === "vertical" || stack.step() === "category"}>
          <Button variant="primary" icon="arrow-right" onClick={stack.next} disabled={busy() || !stack.verticalID()}>
            {language.t(stack.step() === "vertical" ? "stack.action.start" : "stack.action.next")}
          </Button>
        </Show>
        <Show when={stack.step() === "resources"}>
          <Button variant="primary" icon="review" onClick={stack.preview} disabled={busy()}>
            {language.t(busy() ? "stack.action.preparing" : "stack.action.review")}
          </Button>
        </Show>
        <Show when={stack.step() === "review"}>
          <Button
            variant="primary"
            icon="checklist"
            onClick={stack.apply}
            disabled={busy() || stack.stale() || stack.blocked()}
          >
            {language.t(busy() ? "stack.action.applying" : "stack.action.apply")}
          </Button>
        </Show>
      </div>
    </footer>
  )
}

function StateConflicts() {
  const stack = useStack()
  const language = useLanguage()
  const conflicts = () => (stack.step() === "review" ? [] : (stack.data()?.state.conflicts ?? []))

  return (
    <Show when={conflicts().length > 0}>
      <Card variant="error" class="stack-review-notice" role="alert">
        <CardTitle variant="error">{language.t("stack.state.conflicts")}</CardTitle>
        <CardDescription>{language.t("stack.state.conflictsDescription")}</CardDescription>
        <For each={conflicts()}>
          {(conflict) => (
            <p>
              <Show when={conflict.resource}>{(resource) => <code class="stack-action-key">{resource()}</code>}</Show>{" "}
              {conflict.message}
            </p>
          )}
        </For>
      </Card>
    </Show>
  )
}

function Content() {
  const stack = useStack()

  return (
    <>
      <Show when={stack.step() === "vertical"}>
        <VerticalStep />
      </Show>
      <Show when={stack.step() === "category"}>
        <CategoryStep />
      </Show>
      <Show when={stack.step() === "resources"}>
        <ResourceStep />
      </Show>
      <Show when={stack.step() === "review"}>
        <ReviewStep />
      </Show>
      <Show when={stack.step() === "result"}>
        <StackResult />
      </Show>
    </>
  )
}

export function StackWizard() {
  const stack = useStack()
  const server = useServer()
  const language = useLanguage()
  const noCatalog = () => (stack.data()?.catalog.catalog.verticals.length ?? 0) === 0
  const error = () =>
    stack.error() ||
    (server.connectionState() === "error" ? (server.errorMessage() ?? language.t("stack.error.connection")) : undefined)

  createEffect(() => {
    stack.step()
    stack.category()
    stack.data()
    queueMicrotask(() => {
      document.querySelector<HTMLElement>(".stack-content h2[tabindex='-1']")?.focus()
    })
  })

  return (
    <div class="stack-app">
      <header class="stack-header">
        <div>
          <span class="stack-kicker">{language.t("stack.header.kicker")}</span>
          <h1>{language.t("stack.header.title")}</h1>
        </div>
        <Show when={server.workspaceDirectory()}>
          <span class="stack-project-path" title={server.workspaceDirectory()}>
            {server.workspaceDirectory()}
          </span>
        </Show>
      </header>
      <Show when={stack.project() !== undefined} fallback={<StackLoading />}>
        <Show
          when={stack.project()}
          fallback={
            <div class="stack-state-layout">
              <StackProjectRequired />
              <Button variant="ghost" onClick={stack.cancel}>
                {language.t("stack.action.close")}
              </Button>
            </div>
          }
        >
          <Show
            when={stack.data()}
            fallback={
              <Show when={error()} fallback={<StackLoading />}>
                {(message) => (
                  <div class="stack-state-layout">
                    <Card variant="error" role="alert">
                      <CardTitle variant="error">{language.t("stack.error.title")}</CardTitle>
                      <CardDescription>{message()}</CardDescription>
                    </Card>
                    <div class="stack-state-actions">
                      <Button variant="secondary" onClick={stack.reload}>
                        {language.t("stack.error.retry")}
                      </Button>
                      <Button variant="ghost" onClick={stack.cancel}>
                        {language.t("stack.action.close")}
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
            }
          >
            <Show
              when={!noCatalog()}
              fallback={
                <div class="stack-state-layout">
                  <Card variant="info">
                    <CardTitle variant="info">{language.t("stack.empty.title")}</CardTitle>
                    <CardDescription>{language.t("stack.empty.description")}</CardDescription>
                  </Card>
                  <Button variant="ghost" onClick={stack.cancel}>
                    {language.t("stack.action.close")}
                  </Button>
                </div>
              }
            >
              <div class="stack-layout">
                <Rail />
                <div class="stack-workspace">
                  <main class="stack-content" aria-busy={!!stack.busy()}>
                    <Show when={error()}>
                      {(message) => (
                        <Card variant="error" class="stack-inline-error" role="alert">
                          <CardTitle variant="error">{language.t("stack.error.actionTitle")}</CardTitle>
                          <CardDescription>{message()}</CardDescription>
                          <Button variant="secondary" onClick={stack.reload} disabled={!stack.editable()}>
                            {language.t("stack.error.retry")}
                          </Button>
                        </Card>
                      )}
                    </Show>
                    <StateConflicts />
                    <Show when={stack.busy() === "preview"}>
                      <div class="stack-progress" role="status" aria-live="polite">
                        <Spinner />
                        <span>{language.t("stack.preview.progress")}</span>
                      </div>
                    </Show>
                    <Show when={stack.busy() === "apply"}>
                      <div class="stack-progress" role="status" aria-live="polite">
                        <Spinner />
                        <span>{language.t("stack.apply.progress")}</span>
                      </div>
                    </Show>
                    <Content />
                  </main>
                  <Footer />
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
