import { createContext, createMemo, Show, useContext } from "solid-js"
import type { AssistantMessage, Part, Provider, StepFinishPart } from "@kilocode/sdk/v2"
import { useTheme } from "@tui/context/theme"
import * as Model from "@tui/util/model"
import { KiloRoutedModel } from "@/kilocode/session/routed-model"

export namespace RoutedModelMeta {
  type Providers = Provider[] | ReadonlyMap<string, Provider> | undefined
  type Message = Pick<AssistantMessage, "providerID" | "modelID">

  export type Info = {
    labels: ReadonlyMap<string, string>
    consumed: ReadonlySet<string>
    footer?: string
  }

  const empty: Info = {
    labels: new Map(),
    consumed: new Set(),
  }

  export const Context = createContext<() => Info>(() => empty)

  function eligible(part: Part, details: boolean) {
    if (part.type === "reasoning") return true
    if (part.type !== "tool") return false
    return details || part.state.status !== "completed"
  }

  function boundary(part: Part, details: boolean) {
    return part.type === "step-start" || part.type === "step-finish" || eligible(part, details)
  }

  export function label(list: Providers, model: StepFinishPart["model"]) {
    if (!model) return undefined
    const id = KiloRoutedModel.display(model.modelID)
    const name = Model.name(list, model.providerID, model.modelID)
    const text = name === model.modelID && id !== model.modelID ? Model.name(list, model.providerID, id) : name
    return KiloRoutedModel.displayName(text)
  }

  function routed(model: StepFinishPart["model"], message: Message) {
    if (!model) return undefined
    if (message.providerID !== "kilo") return undefined
    if (!message.modelID.startsWith("kilo-auto/")) return undefined
    if (model.providerID === message.providerID && model.modelID === message.modelID) return undefined
    return model
  }

  function finish(parts: Part[], index: number, details: boolean) {
    const part = parts.slice(index + 1).find((item) => boundary(item, details))
    if (part?.type !== "step-finish") return undefined
    return part
  }

  function footer(parts: Part[]) {
    return parts
      .filter((part): part is StepFinishPart => part.type === "step-finish")
      .at(-1)
  }

  export function info(list: Providers, parts: Part[], details: boolean, message: Message): Info {
    const entries = parts.flatMap((part, index) => {
      if (!eligible(part, details)) return []
      const item = finish(parts, index, details)
      const text = label(list, routed(item?.model, message))
      if (!item || !text) return []
      return [[part.id, text, item.id] as const]
    })
    const foot = footer(parts)
    const text = label(list, routed(foot?.model, message))
    return {
      labels: new Map(entries.map((entry) => [entry[0], entry[1]] as const)),
      consumed: new Set([...entries.map((entry) => entry[2]), ...(foot && text ? [foot.id] : [])]),
      ...(text ? { footer: text } : {}),
    }
  }

  function Badge(props: { text: string }) {
    const { theme } = useTheme()

    return <span style={{ fg: theme.textMuted }}> · {props.text}</span>
  }

  export function View(props: { id?: string }) {
    const info = useContext(Context)
    const text = createMemo(() => (props.id ? info().labels.get(props.id) : undefined))

    return (
      <Show when={text()}>
        {(value) => <Badge text={value()} />}
      </Show>
    )
  }
}
