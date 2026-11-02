import type { SessionMessageAssistant } from "@opencode/client"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { ContentPart, useGrowIn, type ToolActions } from "@kilocode/kilo-ui/message-part"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useToolMotion, useToolSize } from "@kilocode/kilo-ui/tool-motion"
import type { ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { useVSCode } from "../context/vscode"
import { formatClock, formatDuration } from "../utils/message-time"
import { color } from "../utils/timeline/colors"
import type { TimelineHighlight } from "../utils/timeline/highlight"
import { partKey, timelinePart } from "../utils/timeline/timeline-parts"
import { useV2 } from "./client"
import { tokenThroughputVisible } from "./kilo-settings"
import { mcpServerFromError } from "./mcp-error"
import { formatTokenThroughput, turnMetadata } from "./message-status"

export function AssistantMessage(props: {
  message: SessionMessageAssistant
  session: string
  actions?: ToolActions
  /** The task-timeline bar under the pointer or keyboard focus, if any. */
  highlight?: () => TimelineHighlight | undefined
}) {
  const v2 = useV2()
  const language = useLanguage()
  const vscode = useVSCode()
  const done = () => props.message.time.completed !== undefined
  const copy = () =>
    done() ? props.message.content.findLastIndex((item) => item.type === "text" && !!item.text.trim()) : -1
  const messages = () => v2.data.session.message.list(props.session)
  // The turn's terminal step drives the timing and rate; its last text-bearing
  // step carries them, so an empty or error-terminal step still shows them on
  // the earlier text row.
  const metadata = createMemo(() => turnMetadata(props.message, messages()))
  const isCarrier = () => metadata()?.carrierID === props.message.id
  const timing = createMemo(() => (isCarrier() ? metadata()?.timing : undefined))
  const throughputValue = createMemo(() =>
    isCarrier() && tokenThroughputVisible() ? metadata()?.tokensPerSecond : undefined,
  )
  const throughputEl = createMemo<JSX.Element | undefined>(() => {
    const value = throughputValue()
    if (value === undefined) return undefined
    const speed = formatTokenThroughput(value, language.locale())
    return (
      <Tooltip value={language.t("chat.throughput.tooltip", { speed })} placement="top">
        <span data-component="assistant-throughput">{speed}</span>
      </Tooltip>
    )
  })
  const turnMetaEl = createMemo<JSX.Element | undefined>(() => {
    const value = timing()
    if (!value) return undefined
    return (
      <span data-component="message-time">
        {formatClock(value.completedAt, language.locale())}
        <Show when={value.durationMs}>
          {(ms) => <span data-slot="message-time-duration"> · {formatDuration(ms())}</span>}
        </Show>
      </span>
    )
  })
  // A failed MCP tool call points at the server row that can fix it.
  const errorAction = (error: { type: string; message: string }) => {
    const server = mcpServerFromError(error.message)
    if (!server) return undefined
    return (
      <Button
        variant="secondary"
        size="small"
        onClick={() =>
          vscode.postMessage({
            type: "openSettingsTab",
            tab: "agentBehaviour",
            subtab: "mcpServers",
            focus: server,
          } satisfies ToHost as never)
        }
      >
        {language.t("prompt.mcp.openSettings")}
      </Button>
    )
  }
  return (
    <div
      class="vscode-session-turn"
      data-row="assistant"
      data-message={props.message.id}
      data-session={props.session}
      data-live={!done() ? "" : undefined}
    >
      <div class="vscode-session-turn-assistant">
        <For each={props.message.content}>
          {(item, index) => {
            const [el, setEl] = createSignal<HTMLDivElement>()
            const [body, setBody] = createSignal<HTMLDivElement>()
            const motion =
              item.type === "tool" ? useToolMotion({ id: item.id, status: () => item.state.status }) : undefined
            if (motion) useToolSize({ el, body, active: () => motion.live() && !done(), motion })
            // As on v1: a live text part reveals with a grow-in; reasoning and tool parts animate their own height.
            useGrowIn(el, item.type === "text" && !done())
            const key = partKey(props.message.id, item, index())
            const highlighted = () =>
              props.highlight?.()?.msgId === props.message.id && props.highlight?.()?.partId === key
            const highlightColor = () => {
              if (!highlighted()) return undefined
              const part = timelinePart(props.message, item, index())
              return part ? color(part) : undefined
            }
            return (
              <div
                ref={setEl}
                data-component="tool-part-wrapper"
                data-part-type={item.type}
                data-part-id={key}
                data-timeline-highlight={highlighted() ? "" : undefined}
                data-tool-enter={motion?.entering() ? "" : undefined}
                data-tool-live={motion?.live() ? "" : undefined}
                data-tool-status={
                  item.type === "tool" ? (item.state.status === "streaming" ? "pending" : item.state.status) : undefined
                }
                style={{
                  "--timeline-color": highlightColor(),
                  "--tool-stagger": motion?.stagger(),
                  "--tool-beat": motion?.beat(),
                }}
                onAnimationEnd={(event) => {
                  if (event.animationName === "tool-motion-pop") return motion?.beaten()
                  if (event.target === event.currentTarget && event.animationName === "tool-motion-enter")
                    motion?.entered()
                }}
              >
                <div ref={setBody} data-slot="tool-part-body">
                  <ContentPart
                    item={item}
                    message={props.message}
                    index={index()}
                    directory={v2.directory}
                    open={v2.open}
                    copy={index() === copy()}
                    throughput={index() === copy() ? throughputEl() : undefined}
                    turnMeta={index() === copy() ? turnMetaEl() : undefined}
                    settled={index() < props.message.content.length - 1}
                    defaultOpen={item.type === "tool" && (item.name === "shell" || item.name === "todowrite")}
                    actions={props.actions}
                    errorAction={errorAction}
                  />
                </div>
              </div>
            )
          }}
        </For>
        <Show when={props.message.error}>{(error) => <ErrorCard error={error()} />}</Show>
      </div>
    </div>
  )
}

/** The error card of an assistant step. The message list also uses it for a run that fails before a step. */
export function ErrorCard(props: { error: { message: string } }) {
  const language = useLanguage()
  return (
    <Card variant="error" class="error-card" role="alert">
      <div class="error-card-body">
        <Icon name="warning" size="small" />
        <div class="error-card-message">{props.error.message}</div>
      </div>
      <Collapsible variant="ghost">
        <Collapsible.Trigger class="error-details-trigger">
          <span>{language.t("error.details.show")}</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <pre>{JSON.stringify(props.error, null, 2)}</pre>
        </Collapsible.Content>
      </Collapsible>
    </Card>
  )
}
