import { For, Show, createMemo, type Accessor, type Component } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { createBrowserController } from "./controller"
import type { BrowserController } from "./controller"
import type { BrowserLabels, BrowserPosition, BrowserScope, BrowserState, BrowserTransport } from "./types"
import type { BrowserReference } from "../../src/shared/browser-feedback"
import "./browser.css"

function position(event: MouseEvent & { currentTarget: HTMLButtonElement }): BrowserPosition {
  const bounds = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    width: bounds.width,
    height: bounds.height,
  }
}

const Toolbar: Component<{
  controller: BrowserController
  labels: BrowserLabels
  title?: string
  active: boolean
}> = (props) => {
  const ready = () => !!props.controller.state()?.url && props.controller.state()?.status !== "closed"
  return (
    <div class="am-browser-toolbar">
      <Tooltip value={props.labels.refresh} placement="bottom">
        <IconButton
          icon="refresh"
          size="small"
          variant="ghost"
          aria-label={props.labels.refresh}
          onClick={props.controller.refresh}
          disabled={!ready() || props.controller.loading()}
        />
      </Tooltip>
      <form
        class="am-browser-address"
        title={props.title}
        onSubmit={(event) => {
          event.preventDefault()
          if (props.active && props.controller.url().trim() && !props.controller.loading()) props.controller.open()
        }}
      >
        <Show when={props.controller.loading()}>
          <span class="am-browser-site" aria-hidden="true">
            <Spinner />
          </span>
        </Show>
        <TextField
          class="am-browser-url"
          variant="ghost"
          value={props.controller.url()}
          onChange={props.controller.setUrl}
          placeholder={props.labels.urlPlaceholder}
          aria-label={props.labels.url}
          spellcheck={false}
          autocomplete="off"
          onFocus={(event: FocusEvent & { currentTarget: HTMLInputElement }) => event.currentTarget.select()}
        />
        <Tooltip value={props.labels.open} placement="bottom">
          <IconButton
            type="submit"
            icon="arrow-right"
            size="small"
            variant="ghost"
            aria-label={props.labels.open}
            disabled={!props.controller.url().trim() || !props.active || props.controller.loading()}
          />
        </Tooltip>
      </form>
      <Tooltip value={props.labels.inspect} placement="bottom">
        <IconButton
          icon="window-cursor"
          size="small"
          variant={props.controller.selecting() ? "secondary" : "ghost"}
          aria-label={props.labels.inspect}
          aria-pressed={props.controller.selecting()}
          disabled={!ready() || props.controller.loading()}
          onClick={props.controller.toggleSelecting}
        />
      </Tooltip>
      <div class="am-browser-tools-action">
        <Tooltip value={props.labels.devtoolsTitle} placement="bottom">
          <IconButton
            icon="console"
            size="small"
            variant={props.controller.tools() ? "secondary" : "ghost"}
            aria-label={props.labels.devtoolsTitle}
            aria-pressed={!!props.controller.tools()}
            onClick={props.controller.toggleTools}
            disabled={!ready() || props.controller.loading()}
          />
        </Tooltip>
      </div>
      <Tooltip value={props.labels.close} placement="bottom">
        <IconButton
          icon="close"
          size="small"
          variant="ghost"
          aria-label={props.labels.close}
          onClick={props.controller.close}
        />
      </Tooltip>
    </div>
  )
}

const Picker: Component<{
  active: boolean
  controller: BrowserController
  labels: BrowserLabels
}> = (props) => {
  const bounds = () => props.controller.hovered()?.element?.rect
  return (
    <Show when={props.active}>
      <button
        type="button"
        class="am-browser-inspect"
        aria-label={props.labels.inspect}
        onMouseMove={(event) => props.controller.move(position(event))}
        onClick={(event) => props.controller.select(position(event))}
      />
      <Show when={bounds()} keyed>
        {(rect) => (
          <div
            class="am-browser-hover-outline"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          >
            <span classList={{ "am-browser-hover-label-inside": rect.y < 0.05 }}>
              {props.controller.hovered()?.element?.selector}
            </span>
          </div>
        )}
      </Show>
    </Show>
  )
}

const Viewport: Component<{
  state?: BrowserState
  session?: string
  controller: BrowserController
  labels: BrowserLabels
}> = (props) => {
  const issue = () => props.state?.frameError || props.state?.error
  const page = () =>
    props.state?.url &&
    props.state.status !== "closed" &&
    (props.state.status !== "error" || !!props.state.title) &&
    props.state.url
  const identity = () => {
    const url = page()
    return url ? `${props.state?.browserId}:${props.state?.navigation ?? 0}:${url}` : undefined
  }
  return (
    <div class="am-browser-viewport" aria-live="polite">
      <Show
        when={identity()}
        keyed
        fallback={
          <Show when={!issue()}>
            <div class="am-browser-empty">
              <div>{props.session ? props.labels.empty : props.labels.noSession}</div>
            </div>
          </Show>
        }
      >
        {(_key) => (
          <iframe
            class="am-browser-frame"
            src={props.state?.url}
            title={props.labels.screenshotAlt}
            sandbox="allow-scripts allow-forms allow-same-origin"
            referrerpolicy="no-referrer"
          />
        )}
      </Show>
      <Picker
        active={(props.controller.selecting() || props.controller.pointing()) && !!props.state?.url}
        controller={props.controller}
        labels={props.labels}
      />
      <Show when={issue()}>
        {(message) => (
          <Card variant="error" class="error-card am-browser-error-overlay" role="alert">
            <div class="error-card-body">
              <Icon name="warning" size="small" />
              <div class="error-card-message">{message()}</div>
            </div>
          </Card>
        )}
      </Show>
    </div>
  )
}

const Tools: Component<{ url: string; labels: BrowserLabels }> = (props) => (
  <section class="am-browser-devtools" aria-label={props.labels.devtoolsTitle}>
    <iframe
      class="am-browser-devtools-frame"
      src={props.url}
      title={props.labels.devtoolsTitle}
      sandbox="allow-scripts allow-forms allow-same-origin"
      referrerpolicy="no-referrer"
    />
  </section>
)

const Diagnostics: Component<{ logs: string[]; errors: number; labels: BrowserLabels }> = (props) => {
  const entries = createMemo(() => {
    const counts = new Map<string, number>()
    for (const text of props.logs) counts.set(text, (counts.get(text) ?? 0) + 1)
    return Array.from(counts, ([text, count]) => ({ text, count }))
  })
  return (
    <Show when={props.logs.length || props.errors}>
      <Collapsible variant="ghost" class="am-browser-diagnostics">
        <Collapsible.Trigger>
          <span>{props.errors ? props.labels.errors(props.errors) : props.labels.diagnostics}</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="am-browser-diagnostics-hint">{props.labels.diagnosticsHint}</div>
          <div class="am-browser-console" role="log" aria-live="polite">
            <For each={entries()}>
              {(entry) => (
                <div class="am-browser-console-entry" data-level={entry.text.match(/^\[([^\]]+)\]/)?.[1] ?? "error"}>
                  <span>{entry.text}</span>
                  <Show when={entry.count > 1}>
                    <span class="am-browser-console-count">×{entry.count}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}

export interface BrowserPanelProps {
  scope: Accessor<BrowserScope | undefined>
  transport: BrowserTransport
  labels: BrowserLabels
  onReference: (reference: BrowserReference) => void
  onClose: () => void
  theme?: Accessor<"dark" | "light">
}

export const BrowserPanel: Component<BrowserPanelProps> = (props) => {
  const controller = createBrowserController({
    scope: props.scope,
    transport: props.transport,
    onReference: props.onReference,
    onClose: props.onClose,
    theme: props.theme,
  })
  const state = controller.state
  return (
    <div
      class="am-browser-panel"
      aria-label={props.labels.title}
      aria-busy={controller.loading()}
      data-status={state()?.status ?? "closed"}
    >
      <Toolbar
        controller={controller}
        labels={props.labels}
        title={state()?.title}
        active={!!props.scope()?.sessionId}
      />
      <div class="am-browser-workspace" classList={{ "am-browser-workspace-docked": !!controller.tools() }}>
        <Viewport state={state()} session={props.scope()?.sessionId} controller={controller} labels={props.labels} />
        <Show when={controller.tools()} keyed>
          {(entry) => <Tools url={entry.url} labels={props.labels} />}
        </Show>
      </div>
      <Diagnostics logs={state()?.logs ?? []} errors={state()?.errors ?? 0} labels={props.labels} />
    </div>
  )
}
