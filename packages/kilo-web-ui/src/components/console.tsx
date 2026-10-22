import { Show, splitProps, type ComponentProps, type JSX } from "solid-js"
import { Card, CardContent, CardHeader, CardTitle } from "./card"
import { Icon, type IconProps } from "./icon"
import { Tag } from "./tag"

export function ConfigTag(props: ComponentProps<typeof Tag>) {
  return <Tag {...props} data-slot="config-tag" />
}

export function ConfigCountTag(props: ComponentProps<"span">) {
  return <ConfigTag {...props} tone="neutral" />
}

export { ConfigCountTag as CountTag }

type Tone = "neutral" | "success" | "warning" | "critical" | "info" | "brand"
type Source = "default" | "global" | "project" | "system" | "inherited" | "local override" | string | undefined
type Kind = "default" | "global" | "project"

function kind(input: { source?: Source; inherited?: boolean; overridden?: boolean }): Kind {
  if (input.source === "project" || input.source === "local override") return "project"
  if (input.source === "global" || input.source === "inherited") return "global"
  if (input.overridden) return "project"
  if (input.inherited) return "global"
  return "default"
}

export function StatusDot(props: { tone: Exclude<Tone, "brand" | "info"> }) {
  return <span data-slot="status-dot" data-tone={props.tone} aria-hidden="true" />
}

export function StatusTag(props: {
  status: "connected" | "failed" | "running" | "stopped" | "error" | "healthy" | "unhealthy" | "unknown" | string
}) {
  const meta = () => {
    if (["connected", "healthy", "running"].includes(props.status))
      return {
        tone: "success" as const,
        label: props.status === "healthy" ? "Healthy" : props.status === "running" ? "Running" : "Connected",
      }
    if (["failed", "error", "unhealthy"].includes(props.status))
      return {
        tone: "critical" as const,
        label: props.status === "unhealthy" ? "Unhealthy" : props.status === "failed" ? "Failed" : "Error",
      }
    if (props.status === "stopped") return { tone: "neutral" as const, label: "Stopped" }
    return { tone: "neutral" as const, label: props.status || "Unknown" }
  }
  return (
    <ConfigTag tone={meta().tone} class="kw-status-tag">
      <StatusDot tone={meta().tone === "critical" ? "critical" : meta().tone === "success" ? "success" : "neutral"} />
      {meta().label}
    </ConfigTag>
  )
}

export function SourceBadge(props: { source?: Source; inherited?: boolean; overridden?: boolean }) {
  const source = () => kind(props)
  const label = () => source().toUpperCase()
  return (
    <ConfigTag class="mono" tone={source() === "project" ? "info" : "neutral"}>
      {label()}
    </ConfigTag>
  )
}

export function PageHeader(props: {
  title: JSX.Element
  actions?: JSX.Element
  description?: JSX.Element
  meta?: JSX.Element
}) {
  return (
    <section data-component="page-header">
      <div data-slot="page-header-main">
        <h1>{props.title}</h1>
        <Show when={props.actions}>{(actions) => <div data-slot="page-header-actions">{actions()}</div>}</Show>
      </div>
      <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
      <Show when={props.meta}>{(meta) => <div data-slot="page-header-meta">{meta()}</div>}</Show>
    </section>
  )
}

export function SectionTitle(props: { children: JSX.Element; trailing?: JSX.Element; description?: JSX.Element }) {
  return (
    <section data-component="section-title">
      <div>
        <h2>{props.children}</h2>
        {props.trailing}
      </div>
      <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
    </section>
  )
}

export function Banner(props: {
  tone?: "info" | "warning" | "critical" | "success"
  title?: JSX.Element
  action?: JSX.Element
  children: JSX.Element
}) {
  const icon = () => {
    if (props.tone === "critical") return "warning" as IconProps["name"]
    if (props.tone === "warning") return "warning" as IconProps["name"]
    if (props.tone === "success") return "circle-check" as IconProps["name"]
    return "help" as IconProps["name"]
  }
  return (
    <div data-component="banner" data-tone={props.tone ?? "info"} role="alert">
      <Icon name={icon()} size="small" />
      <div>
        <Show when={props.title}>{(title) => <strong>{title()}</strong>}</Show>
        <span>{props.children}</span>
      </div>
      {props.action}
    </div>
  )
}

export function Chip(props: { children: JSX.Element; onRemove?: () => void; mono?: boolean }) {
  return (
    <Tag tone="neutral" classList={{ mono: props.mono }}>
      <span>{props.children}</span>
      <Show when={props.onRemove}>
        {(remove) => (
          <button type="button" data-slot="chip-remove" aria-label="Remove" onClick={remove()}>
            x
          </button>
        )}
      </Show>
    </Tag>
  )
}

export function ConfigRow(props: {
  leading?: JSX.Element
  title: JSX.Element
  subtitle?: JSX.Element
  source?: Source
  status?: JSX.Element
  actions?: JSX.Element
  highlightOverride?: boolean
  href?: string
  onClick?: () => void
}) {
  const override = () => kind({ source: props.source }) === "project" || props.highlightOverride
  const body = () => (
    <>
      <Show when={override()}>
        <span data-slot="config-row-accent" />
      </Show>
      <Show when={props.leading}>{(leading) => <div data-slot="config-row-leading">{leading()}</div>}</Show>
      <div data-slot="config-row-body">
        <div data-slot="config-row-title">{props.title}</div>
        <Show when={props.subtitle}>{(subtitle) => <div data-slot="config-row-subtitle">{subtitle()}</div>}</Show>
      </div>
      <div data-slot="config-row-trailing">
        <Show when={props.source !== undefined}>
          <SourceBadge source={props.source} />
        </Show>
        {props.status}
        <Show when={props.actions}>{(actions) => <div data-slot="config-row-actions">{actions()}</div>}</Show>
      </div>
    </>
  )
  if (props.href)
    return (
      <a data-component="config-row" data-override={override() || undefined} href={props.href}>
        {body()}
      </a>
    )
  if (props.onClick)
    return (
      <button type="button" data-component="config-row" data-override={override() || undefined} onClick={props.onClick}>
        {body()}
      </button>
    )
  return (
    <div data-component="config-row" data-override={override() || undefined}>
      {body()}
    </div>
  )
}

export function CardWithHeader(props: { title: JSX.Element; description?: JSX.Element; children: JSX.Element }) {
  return (
    <Card padding={0}>
      <CardHeader class="kw-card-header-border">
        <CardTitle>{props.title}</CardTitle>
        <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

export function SimpleSelect(props: ComponentProps<"select"> & { options: Array<{ value: string; label: string }> }) {
  const [local, rest] = splitProps(props, ["options", "children"])
  return (
    <select {...rest}>
      {local.options.map((item) => (
        <option value={item.value}>{item.label}</option>
      ))}
      {local.children}
    </select>
  )
}
