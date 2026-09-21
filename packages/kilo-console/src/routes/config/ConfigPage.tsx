import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { ConfigCountTag, ConfigTag, SourceBadge as UiSourceBadge } from "@kilocode/kilo-web-ui/console"

export { ConfigCountTag, ConfigTag }

export function ConfigPage(props: {
  title: JSX.Element
  description?: JSX.Element
  actions?: JSX.Element
  children?: JSX.Element
}) {
  return (
    <main class="config-page">
      <section class="config-page-header">
        <div>
          <h1>{props.title}</h1>
          <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
        </div>
        <Show when={props.actions}>{(actions) => <div class="config-page-actions">{actions()}</div>}</Show>
      </section>
      {props.children}
    </main>
  )
}

export function ConfigToolbar(props: {
  title?: string
  description?: string
  meta?: JSX.Element
  children?: JSX.Element
}) {
  return (
    <Show when={props.children || props.meta}>
      <section class="config-toolbar">
        <Show when={props.children}>{(children) => <div class="config-toolbar-controls">{children()}</div>}</Show>
        <Show when={props.meta}>{(meta) => <div class="config-toolbar-meta">{meta()}</div>}</Show>
      </section>
    </Show>
  )
}

export function ConfigToggle(props: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      class="ui-toggle"
      classList={{ selected: props.checked }}
      type="button"
      aria-pressed={props.checked}
      disabled={props.disabled}
      onClick={props.onChange}
    >
      <span>
        <strong>{props.label}</strong>
        <small>{props.description}</small>
      </span>
      <ConfigTag tone={props.checked ? "success" : "neutral"}>{props.checked ? "On" : "Off"}</ConfigTag>
    </button>
  )
}

export function SourceBadge(props: { source?: string; inherited?: boolean; overridden?: boolean }) {
  return <UiSourceBadge {...props} />
}
