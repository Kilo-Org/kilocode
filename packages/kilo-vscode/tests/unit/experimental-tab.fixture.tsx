import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { Config, WebviewMessage } from "../../webview-ui/src/types/messages"
import { dict } from "../../webview-ui/src/i18n/en"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
const sent: WebviewMessage[] = []
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLHeadElement: window.HTMLHeadElement,
  HTMLInputElement: window.HTMLInputElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({
    postMessage: (message: WebviewMessage) => sent.push(message),
    getState: () => undefined,
    setState: () => {},
  }),
})

const { render } = await import("solid-js/web")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { ConfigProvider, useConfig } = await import("../../webview-ui/src/context/config")
const { ImageModelsProvider } = await import("../../webview-ui/src/context/image-models")
const { default: ExperimentalTab } = await import("../../webview-ui/src/components/settings/ExperimentalTab")
const { post } = await import("../../webview-ui/src/utils/webview-message")

const ref = { value: undefined as ReturnType<typeof useConfig> | undefined }
const Probe = () => {
  ref.value = useConfig()
  return <ExperimentalTab />
}
const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider languageOverride={() => "en"}>
        <ConfigProvider>
          <ImageModelsProvider>
            <Probe />
          </ImageModelsProvider>
        </ConfigProvider>
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)

const enabled = { experimental: { minimal_mode: true, batch_tool: true, mcp_timeout: 12345 } }
const disabled = { experimental: { minimal_mode: false, batch_tool: true, mcp_timeout: 12345 } }
const cases: [Config, boolean, string | undefined, string[][]][] = [
  [{ ...enabled, default_agent: "minimal" }, false, undefined, [["default_agent"]]],
  [{ ...enabled, default_agent: "reviewer" }, false, "reviewer", []],
  [{ ...enabled, default_agent: null }, false, undefined, []],
  [enabled, false, undefined, []],
  [{ ...disabled, default_agent: "minimal" }, true, "minimal", []],
  [{ ...disabled, default_agent: "reviewer" }, true, "reviewer", []],
  [{}, true, undefined, []],
]
const project: Config = { commit_message: { prompt: "Keep project conventions" } }
const features = { indexing: false, sandboxControls: false, backgroundSubagents: false }
const title = dict["settings.experimental.minimalMode.title"]

try {
  const value = ref.value
  assert(value)
  for (const [cfg, checked, agent, unset] of cases) {
    const message = {
      type: "configLoaded",
      config: { ...cfg, ...project },
      globalConfig: cfg,
      projectConfig: project,
      features,
    }
    post(message)
    sent.length = 0
    const control = [...root.querySelectorAll('[data-component="switch"]')].find(
      (node) => node.querySelector('[data-slot="switch-label"]')?.textContent === title,
    )
    const input = control?.querySelector<HTMLInputElement>("input")
    assert(input)
    assert.equal(input.checked, !checked)
    input.click()
    assert.equal(input.checked, checked)
    assert.equal(value.config().default_agent, agent)
    assert.equal(value.config().experimental?.minimal_mode, checked)
    assert.equal(value.isDirty(), true)
    assert.deepEqual(value.projectConfig(), project)
    post(message)
    assert.equal(value.config().default_agent, agent)
    assert.equal(value.config().experimental?.minimal_mode, checked)
    value.saveConfig()
    assert.deepEqual(sent, [
      {
        type: "updateConfig",
        config: { experimental: { ...cfg.experimental, minimal_mode: checked } },
        projectConfig: {},
        globalUnset: unset,
        projectUnset: [],
        globalBindingId: undefined,
        projectBindingId: undefined,
      },
    ])
    post({ ...message, type: "configUpdated", config: value.config() })
    assert.equal(value.isDirty(), false)
    assert.equal(value.saving(), false)
  }
} finally {
  dispose()
  await window.happyDOM.close()
}
