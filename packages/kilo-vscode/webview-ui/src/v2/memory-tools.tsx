// Tool cards of the project memory tools. `kilo_memory_recall` and `kilo_memory_save` return text written for the
// model, so the cards show a user-facing summary instead: the recalled memory texts or the outcome of a save, and
// the memory files they came from. The header shows the query or saved text while the call still waits for its
// permission prompt.
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { ToolRegistry, type ToolProps } from "@kilocode/kilo-ui/message-part"
import { TextShimmer } from "@kilocode/kilo-ui/text-shimmer"
import { For, Match, Show, Switch, type JSX } from "solid-js"
import { useLanguage } from "../context/language"
import { localeToBcp47 } from "../context/language-utils"
import {
  MEMORY_RECALL,
  MEMORY_SAVE,
  memoryActionKey,
  memoryPlural,
  memoryRecallCount,
  memoryRecallItems,
  memorySaveOutcome,
  memoryToolSources,
  memoryToolSubtitle,
  type MemorySaveOutcome,
} from "./memory-tool-info"

function busy(status: string) {
  return status === "pending" || status === "running"
}

// The structured trigger of the other v2 cards, except that the subtitle also shows while the call is pending.
function MemoryTrigger(props: { title: string; pending: boolean; subtitle: string; badge?: string }) {
  return (
    <div data-slot="basic-tool-tool-info-structured">
      <div data-slot="basic-tool-tool-info-main">
        <span data-slot="basic-tool-tool-title">
          <TextShimmer text={props.title} active={props.pending} />
        </span>
        <Show when={props.subtitle}>
          <span data-slot="basic-tool-tool-subtitle">{props.subtitle}</span>
        </Show>
        <Show when={props.badge}>
          <span data-slot="basic-tool-tool-arg">{props.badge}</span>
        </Show>
      </div>
    </div>
  )
}

function MemoryBody(props: { sources: string[]; children: JSX.Element }) {
  return (
    <div data-component="memory-tool">
      {props.children}
      <Show when={props.sources.length > 0}>
        <div data-slot="memory-tool-sources">
          <For each={props.sources}>{(source) => <span data-slot="memory-tool-source">{source}</span>}</For>
        </div>
      </Show>
    </div>
  )
}

function RecallTool(props: ToolProps) {
  const language = useLanguage()
  const total = () => (props.status === "completed" ? memoryRecallCount(props.metadata) : undefined)
  const items = () => memoryRecallItems(props.output)
  const badge = () => {
    const value = total()
    if (value === undefined) return undefined
    return memoryPlural(language.t, localeToBcp47(language.locale()), "chat.memory.tool.results", value)
  }
  return (
    <BasicTool
      {...props}
      icon="brain"
      trigger={
        <MemoryTrigger
          title={language.t("chat.memory.tool.recall")}
          pending={busy(props.status)}
          subtitle={memoryToolSubtitle(props.tool, props.input)}
          badge={badge()}
        />
      }
    >
      <Show when={total() !== undefined}>
        <MemoryBody sources={memoryToolSources(props.metadata)}>
          <Show
            when={total()! > 0 && items().length > 0}
            fallback={<div data-slot="memory-tool-empty">{language.t("chat.memory.tool.noMatch")}</div>}
          >
            <ul data-slot="memory-tool-items">
              <For each={items()}>{(item) => <li data-slot="memory-tool-item">{item}</li>}</For>
            </ul>
          </Show>
        </MemoryBody>
      </Show>
    </BasicTool>
  )
}

function SaveTool(props: ToolProps) {
  const language = useLanguage()
  const outcome = () => (props.status === "completed" ? memorySaveOutcome(props.input, props.metadata) : undefined)
  const action = () => {
    const key = memoryActionKey(props.input)
    return key ? language.t(key) : undefined
  }
  const subject = () => memoryToolSubtitle(props.tool, props.input)
  const label = (value: MemorySaveOutcome) => {
    if (value.kind === "saved") return language.t("chat.memory.tool.saved")
    if (value.kind === "corrected") return language.t("chat.memory.tool.corrected")
    if (value.kind === "removed")
      return memoryPlural(language.t, localeToBcp47(language.locale()), "chat.memory.tool.removed", value.count)
    return language.t("chat.memory.tool.unchanged")
  }
  return (
    <BasicTool
      {...props}
      icon="brain"
      trigger={
        <MemoryTrigger
          title={language.t("chat.memory.tool.save")}
          pending={busy(props.status)}
          subtitle={subject()}
          badge={action()}
        />
      }
    >
      <Show when={props.status === "completed"}>
        <MemoryBody sources={outcome()?.kind === "unchanged" || !outcome() ? [] : memoryToolSources(props.metadata)}>
          <Switch fallback={<div data-slot="memory-tool-empty">{props.output}</div>}>
            <Match when={outcome()}>
              {(result) => (
                <div data-slot="memory-tool-outcome">
                  <span data-slot="memory-tool-outcome-label">{label(result())}</span>
                  <Show when={subject()}>
                    <q data-slot="memory-tool-quote">{subject()}</q>
                  </Show>
                </div>
              )}
            </Match>
          </Switch>
        </MemoryBody>
      </Show>
    </BasicTool>
  )
}

ToolRegistry.register({ name: MEMORY_RECALL, render: RecallTool })
ToolRegistry.register({ name: MEMORY_SAVE, render: SaveTool })
