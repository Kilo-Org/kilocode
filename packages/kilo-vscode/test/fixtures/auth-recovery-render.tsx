import assert from "node:assert/strict"
import { Window } from "happy-dom"

const posted: unknown[] = []
const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { configurable: true, value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  SVGElement: window.SVGElement,
  customElements: window.customElements,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  matchMedia: window.matchMedia.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: (message: unknown) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { resolveTemplate } = await import("../../webview-ui/src/context/language-utils")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { dict } = await import("../../webview-ui/src/i18n/en")
const { ErrorCard } = await import("../../webview-ui/src/v2/assistant")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { failureMessage, signInAction } = await import("../../webview-ui/src/v2/kilo-catalog")
const { createModelDrafts } = await import("../../webview-ui/src/v2/model-draft")
const { createSelection, Selectors } = await import("../../webview-ui/src/v2/selectors")
const { ModelSelectorBase } = await import("../../webview-ui/src/components/shared/ModelSelector")

const language = {
  locale: () => "en" as const,
  setLocale: () => undefined,
  userOverride: () => "" as const,
  t: (key: string, params?: Record<string, string | number | boolean | undefined>) =>
    resolveTemplate((dict as Record<string, string>)[key] ?? key, params),
}

function mount(element: () => ReturnType<typeof ErrorCard>) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageContext.Provider value={language}>{element()}</LanguageContext.Provider>
      </VSCodeProvider>
    ),
    host,
  )
  return {
    host,
    cleanup() {
      dispose()
      host.remove()
    },
  }
}

// 1. ErrorCard with provider.auth (401) renders a Sign-In button posting { type: "openProfile", login: true }.
{
  posted.length = 0
  const view = mount(() => <ErrorCard error={{ type: "provider.auth", status: 401, message: "Invalid token" }} />)
  const signIn = view.host.querySelector<HTMLButtonElement>(".error-card-actions button")
  assert.ok(signIn, "expected Sign in button for provider.auth error")
  assert.equal(signIn.textContent?.trim(), "Sign in")
  signIn.click()
  assert.ok(
    posted.some(
      (item) => (item as { type?: string; login?: boolean }).type === "openProfile" && (item as { login?: boolean }).login === true,
    ),
    "clicking Sign in must post openProfile with login: true",
  )
  view.cleanup()
}

// 1b. ErrorCard with 401 INVALID_TOKEN keeps the dedicated auth-prompt card from #16601.
{
  posted.length = 0
  const view = mount(() => (
    <ErrorCard
      error={{
        type: "provider.auth",
        status: 401,
        message: "You've been signed out of Kilo.",
        response: { body: JSON.stringify({ error: { code: "INVALID_TOKEN", message: "Invalid token" } }) },
      }}
    />
  ))
  const prompt = view.host.querySelector('[data-component="auth-prompt"]')
  assert.ok(prompt, "expected auth-prompt card for 401 INVALID_TOKEN")
  assert.equal(view.host.querySelector(".error-card"), null)
  const signIn = prompt.querySelector<HTMLButtonElement>("button")
  assert.ok(signIn)
  signIn.click()
  assert.ok(
    posted.some(
      (item) => (item as { type?: string; login?: boolean }).type === "openProfile" && (item as { login?: boolean }).login === true,
    ),
  )
  view.cleanup()
}

// 2. ErrorCard with provider.auth without status (e.g. Integration.AuthorizationError) also shows Sign-In.
{
  posted.length = 0
  const view = mount(() => <ErrorCard error={{ type: "provider.auth", message: "Authorization required" }} />)
  const signIn = view.host.querySelector<HTMLButtonElement>(".error-card-actions button")
  assert.ok(signIn, "expected Sign in button for status-less provider.auth error")
  signIn.click()
  assert.ok(
    posted.some(
      (item) => (item as { type?: string; login?: boolean }).type === "openProfile" && (item as { login?: boolean }).login === true,
    ),
  )
  view.cleanup()
}

// 3. ErrorCard with status 401 and another type still offers Sign-In.
{
  posted.length = 0
  const view = mount(() => <ErrorCard error={{ type: "unknown", status: 401, message: "Unauthorized" }} />)
  const signIn = view.host.querySelector<HTMLButtonElement>(".error-card-actions button")
  assert.ok(signIn, "expected Sign in button for HTTP 401 error")
  signIn.click()
  assert.ok(
    posted.some(
      (item) => (item as { type?: string; login?: boolean }).type === "openProfile" && (item as { login?: boolean }).login === true,
    ),
  )
  view.cleanup()
}

// 4. ErrorCard with a non-auth error renders no Sign-In action.
{
  const view = mount(() => (
    <ErrorCard error={{ type: "provider.rate-limit", status: 429, message: "Too many requests" }} />
  ))
  assert.equal(view.host.querySelector(".error-card-actions"), null)
  view.cleanup()
}

// 5. ModelSelectorBase with an auth catalog failure enables the trigger and runs onFailureAction on click.
{
  let triggered = 0
  const authFailure = { kind: "unauthorized" as const, status: 401 }
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageContext.Provider value={language}>
          <ModelSelectorBase
            models={[]}
            providers={[]}
            value={null}
            failure={failureMessage(language.t, authFailure)}
            onFailureAction={signInAction(authFailure, () => triggered++)}
            onSelect={() => {}}
          />
        </LanguageContext.Provider>
      </VSCodeProvider>
    ),
    host,
  )
  const trigger = host.querySelector<HTMLButtonElement>("[data-slot='popover-trigger']")
  assert.ok(trigger, "expected model selector trigger")
  assert.equal(trigger.disabled, false, "auth failure trigger with onFailureAction should be clickable")
  assert.equal(
    host.querySelector(".model-selector-trigger-label")?.textContent,
    "Credentials rejected (HTTP 401). Sign in again.",
  )
  trigger.click()
  assert.equal(triggered, 1, "clicking auth failure trigger should invoke sign-in action")
  dispose()
  host.remove()
}

// 6. ModelSelectorBase with a non-auth catalog failure keeps the trigger disabled.
{
  let triggered = 0
  const networkFailure = { kind: "network" as const }
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageContext.Provider value={language}>
          <ModelSelectorBase
            models={[]}
            providers={[]}
            value={null}
            failure={failureMessage(language.t, networkFailure)}
            onFailureAction={signInAction(networkFailure, () => triggered++)}
            onSelect={() => {}}
          />
        </LanguageContext.Provider>
      </VSCodeProvider>
    ),
    host,
  )
  const trigger = host.querySelector<HTMLButtonElement>("[data-slot='popover-trigger']")
  assert.ok(trigger)
  assert.equal(trigger.disabled, true, "non-auth failure trigger should stay disabled")
  trigger.click()
  assert.equal(triggered, 0)
  dispose()
  host.remove()
}

// 7. Selectors wires v2.kiloFailure() into ModelSelectorBase so clicking an auth failure pill posts openProfile,
//    and createSelection preserves draftModel across empty Wave-1 reloads while pruning disabled/missing models.
{
  posted.length = 0
  const makeModel = (providerID: string, id: string, name: string, enabled = true) => ({
    providerID,
    id,
    modelID: id,
    name,
    enabled,
    variants: [],
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    time: { released: 0 },
    cost: [],
    status: "active" as const,
    limit: { context: 200_000, output: 32_000 },
  })
  const [models, setModels] = createSignal<ReturnType<typeof makeModel>[]>([])
  const [kiloFailure, setKiloFailure] = createSignal<{ kind: "unauthorized"; status: 401 } | undefined>({
    kind: "unauthorized",
    status: 401,
  })
  const drafts = createModelDrafts()
  const scope = {
    directory: "/workspace",
    connection: { status: () => "disconnected" },
    bindings: () => ({}),
    kiloFailure,
    kiloModels: () => ({ entries: new Map(), organizationID: undefined, ready: true }),
    drafts,
    report: () => {},
    api: {
      model: { default: async () => ({ data: undefined }) },
    },
    data: {
      session: { get: () => undefined },
      location: {
        agent: { list: () => [], sync: async () => {} },
        model: { list: models, sync: async () => {} },
        provider: { list: () => [], sync: async () => {} },
        config: { list: () => [], sync: async () => {} },
      },
    },
  }
  const host = document.createElement("div")
  document.body.append(host)
  let selection!: ReturnType<typeof createSelection>
  const dispose = render(
    () => (
      <VSCodeProvider>
        <LanguageContext.Provider value={language}>
          <V2Scope value={scope as never}>
            {(() => {
              selection = createSelection(() => undefined)
              return <Selectors selection={selection} blocked={false} />
            })()}
          </V2Scope>
        </LanguageContext.Provider>
      </VSCodeProvider>
    ),
    host,
  )

  const trigger = host.querySelector<HTMLButtonElement>("[data-part='model'] [data-slot='popover-trigger']")
  assert.ok(trigger, "expected model selector trigger inside Selectors")
  assert.equal(trigger.disabled, false)
  trigger.click()
  assert.ok(
    posted.some(
      (item) => (item as { type?: string; login?: boolean }).type === "openProfile" && (item as { login?: boolean }).login === true,
    ),
    "Selectors auth catalog failure click must post openProfile with login: true",
  )

  // Verify draftModel survives empty Wave-1 reload and clears when disabled/removed on settled Wave-2.
  setKiloFailure(undefined)
  setModels([makeModel("kilo", "free", "Free", true)])
  selection.selectModel("kilo", "free")
  assert.deepEqual(selection.model(), { providerID: "kilo", id: "free" })

  // Empty Wave 1 must preserve draftModel.
  setModels([])
  assert.deepEqual(selection.model(), { providerID: "kilo", id: "free" })

  // Wave 2 settles with "free" disabled and "paid" enabled -> stale draftModel drops to new catalog.
  setModels([makeModel("kilo", "free", "Free", false), makeModel("kilo", "paid", "Paid", true)])
  assert.notEqual(selection.model()?.id, "free")

  dispose()
  host.remove()
}
