import type { ModelInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import { useTheme } from "../context/theme"
import type { SessionNode } from "../routes/session/grouping/session"
import { isRecord } from "../util/record"

type Message = Pick<SessionMessageAssistant, "model" | "native">
type Models = ReadonlyArray<Pick<ModelInfo, "providerID" | "id" | "name">> | undefined

export function routedModel(message: Message) {
  if (message.model.providerID !== "kilo") return
  const kilo = message.native?.kilo
  if (!isRecord(kilo)) return
  const id = kilo.routedModelID
  if (typeof id !== "string" || !id.trim() || id.trim() === message.model.id) return
  return { ...message.model, id: id.trim() }
}

export function routedModelLabel(message: Message, models: Models) {
  if (!message.model.id.startsWith("kilo-auto/")) return
  const route = routedModel(message)
  if (!route) return
  return modelLabel(route, models)
}

/** The short display name of a model: its catalog name, or its ID without a date suffix, cleaned as in v1. */
export function modelLabel(model: Pick<ModelInfo, "providerID" | "id">, models: Models) {
  return (findModel(model, models)?.name ?? model.id.replace(DATE, ""))
    .trim()
    .replace(/^[^:]+:\s+/, "")
    .replace(/^[^/\s]+\/(?=[^/]+$)/, "")
    .replace(/\s*\([^)]*%\s*off[^)]*\)\s*$/i, "")
    .replace(/^([A-Za-z]{2,})(?=\d)/, "$1 ")
    .replace(/\s+/g, " ")
}

export function routedModelInfo<T extends Pick<ModelInfo, "providerID" | "id">>(
  message: Message,
  models: ReadonlyArray<T> | undefined,
) {
  const route = routedModel(message)
  if (!route) return
  return findModel(route, models)
}

const DATE = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/

function findModel<T extends Pick<ModelInfo, "providerID" | "id">>(
  model: Pick<ModelInfo, "providerID" | "id">,
  models: ReadonlyArray<T> | undefined,
) {
  return (
    models?.find((item) => item.providerID === model.providerID && item.id === model.id) ??
    models?.find((item) => item.providerID === model.providerID && item.id === model.id.replace(DATE, ""))
  )
}

export function RoutedModelBadge(props: { message: Message; models: Models }) {
  const theme = useTheme()
  return (
    <Show when={routedModelLabel(props.message, props.models)}>
      {(label) => <span style={{ fg: theme.text.muted }}>{` · ${label()}`}</span>}
    </Show>
  )
}

export function groupRoutedModelLabels(
  node: Extract<SessionNode, { type: "group" }>,
  message: (id: string) => SessionMessageInfo | undefined,
  models: Models,
): string[] {
  return [
    ...new Set(
      node.children.flatMap((child) => {
        if (child.type === "group") return groupRoutedModelLabels(child, message, models)
        if (child.entry.type !== "part") return []
        const item = message(child.entry.ref.messageID)
        if (item?.type !== "assistant") return []
        const label = routedModelLabel(item, models)
        return label ? [label] : []
      }),
    ),
  ]
}

export function RoutedGroupBadge(props: {
  node: Extract<SessionNode, { type: "group" }>
  message: (id: string) => SessionMessageInfo | undefined
  models: Models
}) {
  const theme = useTheme()
  return (
    <Show when={groupRoutedModelLabels(props.node, props.message, props.models).join(", ")}>
      {(label) => <span style={{ fg: theme.text.muted }}>{` · ${label()}`}</span>}
    </Show>
  )
}

export function RoutedStep(props: {
  message: SessionMessageInfo | undefined
  part: SessionMessageAssistant["content"][number] | undefined
  models: Models
  children: JSX.Element
}) {
  const theme = useTheme()
  return (
    <>
      {props.children}
      <Show
        when={
          props.message?.type === "assistant" &&
          (props.message.finish === "tool-calls" || props.message.finish === "unknown") &&
          props.part === props.message.content.at(-1) &&
          routedModelLabel(props.message, props.models)
        }
      >
        {(label) => (
          <box paddingLeft={3}>
            <text fg={theme.text.muted}>Routed to {label()}</text>
          </box>
        )}
      </Show>
    </>
  )
}
