import { createEffect, createResource, For, Show } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { Progress } from "@kilocode/kilo-web-ui/progress"
import { applyStack, detectStack, loadStack, loadStackState, previewStack } from "../../client"
import { LoadingScreen } from "../../components/LoadingScreen"
import { useConfig } from "../../context/config"
import { settings, strip } from "../../shared/navigation"
import { ConfigPage, ConfigTag } from "./ConfigPage"
import { createStackWizard, groupStackPlan } from "./state/stack"
import { StackRail } from "./stack/StackRail"
import { StackResourcesStep } from "./stack/StackResourcesStep"
import { StackReviewStep } from "./stack/StackReviewStep"
import { StackTechnologyStep } from "./stack/StackTechnologyStep"
import { StackVerticalStep } from "./stack/StackVerticalStep"
import { StackDetectedStep } from "./stack/StackDetectedStep"
import { StackIntroStep } from "./stack/StackIntroStep"

export function StackRoute() {
  const ctx = useConfig()
  const loc = useLocation()
  const navigate = useNavigate()
  const [bundle, { refetch }] = createResource(ctx.query, async (target) => ({
    target,
    data: await loadStack(target),
  }))
  const state = createStackWizard({
    preview: (target, draft, signal) => previewStack(target, draft, signal),
    apply: (target, draft, hash, signal) => applyStack(target, draft, hash, signal),
    reload: (target, signal) => loadStackState(target, signal),
    detect: (target, signal) => detectStack(target, signal),
  })
  let wizard: HTMLDivElement | undefined

  createEffect(() => state.selectProject(ctx.query()))

  createEffect(() => {
    const next = bundle()
    if (next) state.hydrate(next.data, next.target)
  })

  createEffect(() => {
    state.phase()
    state.index()
    if (!state.catalog()) return
    queueMicrotask(() => wizard?.querySelector<HTMLElement>("[data-stack-focus]")?.focus())
  })

  const exit = () => `${settings(strip(loc.pathname))}${loc.search}`
  const cancel = () => {
    state.cancel()
    navigate(exit())
  }
  const blocked = () =>
    Boolean(state.plan()?.conflicts.length) || groupStackPlan(state.plan()?.actions ?? []).blocked.length > 0

  return (
    <ConfigPage
      title="Project Stack"
      description="Choose project technologies, configure curated Skills and MCP servers, then review every managed change."
    >
      <Show when={bundle.loading && !state.catalog()}>
        <LoadingScreen variant="content" />
      </Show>

      <Show when={bundle.error}>
        <Card class="stack-error" variant="error">
          <strong>Stack catalog unavailable</strong>
          <p>{bundle.error instanceof Error ? bundle.error.message : String(bundle.error)}</p>
          <Button variant="secondary" onClick={() => void refetch()}>
            Retry
          </Button>
        </Card>
      </Show>

      <Show when={state.catalog()}>
        <div ref={(node) => (wizard = node)} class="stack-wizard">
          <StackRail state={state} />

          <div class="stack-main">
            <div class="stack-content">
              <div class="stack-announcements" aria-live="polite">
            <Show when={state.busy() === "detect"}>
              <Card class="stack-busy" variant="info">
                <strong>Detecting project technologies</strong>
                <Progress>Scanning the project filesystem</Progress>
              </Card>
            </Show>
            <Show when={state.busy() === "preview"}>
              <Card class="stack-busy" variant="info">
                <strong>Building a deterministic review plan</strong>
                <Progress>Comparing project resources</Progress>
              </Card>
            </Show>
                <Show when={state.busy() === "apply"}>
                  <Card class="stack-busy" variant="info">
                    <strong>Applying the project stack transactionally</strong>
                    <Progress>Verifying and updating managed resources</Progress>
                  </Card>
                </Show>
                <Show when={state.conflict()}>
                  <Card class="stack-stale" variant="warning">
                    <strong>This plan is stale</strong>
                    <p>The project changed after preview. Refresh to review a new exact plan hash before confirming.</p>
                    <Button variant="secondary" disabled={Boolean(state.busy())} onClick={() => void state.review()}>
                      Refresh plan
                    </Button>
                  </Card>
                </Show>
                <Show when={state.failure()}>
                  {(failure) => (
                    <Card class="stack-error" variant="error">
                      <strong>Stack transaction failed</strong>
                      <p>{failure().message}</p>
                      <p>
                        {failure().rollback
                          ? "Rollback completed."
                          : "Rollback did not complete. Inspect every failed resource before continuing."}
                      </p>
                      <Show when={state.refresh() === "loading"}>
                        <p>Reloading project state before another preview.</p>
                      </Show>
                      <Show when={state.refresh() === "complete"}>
                        <p>Project state was reloaded. Build a new preview before applying again.</p>
                      </Show>
                      <Show when={state.refresh() === "failed"}>
                        <p>{state.error()}</p>
                      </Show>
                      <div class="stack-result-list">
                        <For each={failure().results}>
                          {(item) => (
                            <div class="stack-result-row">
                              <div>
                                <strong>{item.resource}</strong>
                                <code>{item.action}</code>
                                <small>{item.message}</small>
                              </div>
                              <ConfigTag tone={item.success ? "success" : "critical"}>
                                {item.success ? "applied" : "failed"}
                              </ConfigTag>
                            </div>
                          )}
                        </For>
                      </div>
                    </Card>
                  )}
                </Show>
                <Show when={state.error() && !state.failure()}>
                  <Card class="stack-error" variant="error">
                    <strong>Stack request failed</strong>
                    <p>{state.error()}</p>
                  </Card>
                </Show>
                <Show when={state.issues().length}>
                  <Card class="stack-error" variant="error">
                    <strong>Required MCP settings</strong>
                    <ul>
                      <For each={state.issues()}>{(item) => <li>{item.message}</li>}</For>
                    </ul>
                  </Card>
                </Show>
              </div>

          <Show when={state.phase() === "intro"}>
            <StackIntroStep state={state} />
          </Show>
          <Show when={state.phase() === "vertical"}>
            <StackVerticalStep state={state} />
          </Show>
          <Show when={state.phase() === "category"}>
            <StackTechnologyStep state={state} />
          </Show>
              <Show when={state.phase() === "resources"}>
                <StackResourcesStep state={state} />
              </Show>
              <Show when={state.phase() === "review" && state.plan()}>
                <StackReviewStep state={state} />
              </Show>
          <Show when={state.phase() === "detected"}>
            <StackDetectedStep state={state} />
          </Show>
          <Show when={state.phase() === "result" && state.result()}>
            {(result) => (
                  <section class="stack-step stack-result" aria-labelledby="stack-result-title">
                    <div class="stack-result-mark" aria-hidden="true">
                      OK
                    </div>
                    <div class="stack-step-heading">
                      <p class="eyebrow">Transaction complete</p>
                      <h2 id="stack-result-title" data-stack-focus tabIndex={-1}>
                        Project stack updated
                      </h2>
                      <p>The confirmed plan was applied and the project state was refreshed.</p>
                    </div>
                    <div class="stack-result-list">
                      <For each={result().results}>
                        {(item) => (
                          <div class="stack-result-row">
                            <div>
                              <strong>{item.resource}</strong>
                              <code>{item.action}</code>
                              <Show when={item.message}>{(message) => <small>{message()}</small>}</Show>
                            </div>
                            <ConfigTag tone={item.success ? "success" : "critical"}>
                              {item.success ? "applied" : "failed"}
                            </ConfigTag>
                          </div>
                        )}
                      </For>
                    </div>
                    <div class="stack-plan-hash">
                      <span>Applied plan hash</span>
                      <code>{state.hash()}</code>
                    </div>
                  </section>
                )}
              </Show>
            </div>

            <footer class="stack-footer">
              <Show when={state.phase() !== "result"}>
                <Button variant="ghost" disabled={Boolean(state.busy())} onClick={cancel}>
                  Cancel
                </Button>
              </Show>
              <div>
                <Show when={state.phase() === "intro"}>
                  <Button variant="secondary" disabled={Boolean(state.busy())} onClick={state.goManual}>
                    Select manually
                  </Button>
                  <Button variant="primary" disabled={Boolean(state.busy())} onClick={() => void state.detect()}>
                    Auto-detect technologies
                  </Button>
                </Show>
                <Show when={state.phase() === "detected"}>
                  <Button variant="secondary" disabled={Boolean(state.busy())} onClick={state.goManual}>
                    Select manually
                  </Button>
                  <Button
                    variant="primary"
                    disabled={Boolean(state.busy()) || state.detections().length === 0}
                    onClick={state.applyDetection}
                  >
                    Next
                  </Button>
                </Show>
                <Show
                  when={state.phase() === "category" || state.phase() === "resources" || state.phase() === "review"}
                >
                  <Button variant="secondary" disabled={Boolean(state.busy())} onClick={state.back}>
                    Back
                  </Button>
                </Show>
                <Show when={state.phase() === "vertical"}>
                  <Button
                    variant="primary"
                    disabled={!state.currentVertical() || Boolean(state.busy())}
                    onClick={state.start}
                  >
                    Start
                  </Button>
                </Show>
                <Show when={state.phase() === "category"}>
                  <Button variant="primary" disabled={Boolean(state.busy())} onClick={state.nextCategory}>
                    Next
                  </Button>
                </Show>
                <Show when={state.phase() === "resources"}>
                  <Button variant="primary" disabled={Boolean(state.busy())} onClick={() => void state.review()}>
                    Review plan
                  </Button>
                </Show>
                <Show when={state.phase() === "review"}>
                  <Button
                    variant="primary"
                    disabled={Boolean(state.busy()) || blocked() || state.conflict()}
                    onClick={() => void state.confirm()}
                  >
                    Confirm exact plan
                  </Button>
                </Show>
                <Show when={state.phase() === "result"}>
                  <Button variant="primary" onClick={() => navigate(exit())}>
                    Done
                  </Button>
                </Show>
              </div>
            </footer>
          </div>
        </div>
      </Show>
    </ConfigPage>
  )
}
