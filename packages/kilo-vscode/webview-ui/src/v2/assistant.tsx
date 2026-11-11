import type { SessionMessageAssistant } from "@opencode/client"
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { ContentPart, useGrowIn, type ToolActions } from "@kilocode/kilo-ui/message-part"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { ErrorDetails } from "@kilocode/kilo-ui/error-details"
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
import { displaySettings } from "./display-settings"
import { readableMessage } from "./error"
import { tokenThroughputVisible } from "./kilo-settings"
import { mcpServerFromError } from "./mcp-error"
import { formatTokenThroughput, type TurnMetadata } from "./message-status"
import { toolDefaultOpen } from "./tool-default-open"
import { turnDiffs, type TurnFile } from "./turn-diffs"

export function AssistantMessage(props: {
  message: SessionMessageAssistant
  session: string
  actions?: ToolActions
  /** Instruction files one read loaded, by read tool part ID. */
  instructionFiles?: (partID: string) => readonly string[] | undefined
  /** The task-timeline bar under the pointer or keyboard focus, if any. */
  highlight?: () => TimelineHighlight | undefined
  /** Whether the current transcript search match is in this row. */
  searchActive?: boolean
  /** The message content rendered by this row. A large message is split across several rows. */
  parts?: SessionMessageAssistant["content"]
  /** Index of the first rendered content item in the message. */
  start?: number
  /** The turn footer metadata, attached to the turn's carrier row by the transcript partition. */
  metadata?: TurnMetadata
  /** The user message that started the turn, used to read the turn's changes. */
  userTurn?: string
  rowKey?: string
  /** Opens the files changed by this turn. */
  onViewTurnChanges?: () => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const vscode = useVSCode()
  const done = () => props.message.time.completed !== undefined
  // Each step is its own message, so only the turn's carrier step gets the copy row, which keeps it to one per turn.
  const copy = createMemo(() =>
    done() && props.metadata
      ? props.message.content.findLastIndex((item) => item.type === "text" && !!item.text.trim())
      : -1,
  )
  const parts = () => props.parts ?? props.message.content
  const offset = () => props.start ?? 0
  // The error belongs to the whole message, so only its last row renders it.
  const lastChunk = () => offset() + parts().length >= props.message.content.length
  // A completed turn keeps its changed files, read once and reused when the row mounts again.
  const [turnFiles, setTurnFiles] = createSignal<TurnFile[]>([])
  createEffect(
    on(
      () => [props.metadata, props.userTurn, lastChunk()] as const,
      ([metadata, turn]) => {
        if (!metadata || !turn || !lastChunk()) return
        const cached = turnDiffs.read(props.session, turn)
        if (cached) return setTurnFiles(cached)
        void turnDiffs
          .request(props.session, turn, (query) => v2.api.session.diff(query))
          .then(setTurnFiles, (error: unknown) => {
            console.error("[Kilo New] Failed to read the turn changes", error)
            setTurnFiles([])
          })
      },
    ),
  )
  const timing = () => props.metadata?.timing
  const throughputValue = () => (tokenThroughputVisible() ? props.metadata?.tokensPerSecond : undefined)
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
  // The todo list is a status row rather than a tool block, so it stays open as before; every other tool follows
  // the display layouts.
  const defaultOpen = (tool: string) => (tool === "todowrite" ? true : toolDefaultOpen(tool, displaySettings()))
  return (
    <div
      class="vscode-session-turn"
      data-row="assistant"
      data-message={props.message.id}
      data-session={props.session}
      data-row-key={props.rowKey}
      data-live={!done() ? "" : undefined}
      data-search-active={props.searchActive ? "" : undefined}
    >
      <div class="vscode-session-turn-assistant">
        <For each={parts()}>
          {(item, index) => {
            const at = () => offset() + index()
            const [el, setEl] = createSignal<HTMLDivElement>()
            const [body, setBody] = createSignal<HTMLDivElement>()
            const motion =
              item.type === "tool" ? useToolMotion({ id: item.id, status: () => item.state.status }) : undefined
            if (motion) useToolSize({ el, body, active: () => motion.live() && !done(), motion })
            // A live text part reveals with a grow-in; reasoning and tool parts animate their own height.
            useGrowIn(el, item.type === "text" && !done())
            const key = partKey(props.message.id, item, at())
            const highlighted = () =>
              props.highlight?.()?.msgId === props.message.id && props.highlight?.()?.partId === key
            const highlightColor = () => {
              if (!highlighted()) return undefined
              const part = timelinePart(props.message, item, at())
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
                  {/* A card reads its open state once. Keying it on its own layout remounts only the cards whose
                      layout changed, so a settings change shows in open sessions at once. */}
                  <Show when={item.type === "tool" ? `layout:${defaultOpen(item.name)}` : "content"} keyed>
                    {(_layout) => (
                      <ContentPart
                        item={item}
                        message={props.message}
                        index={at()}
                        session={props.session}
                        directory={v2.directory}
                        open={v2.open}
                        copy={at() === copy()}
                        throughput={at() === copy() ? throughputEl() : undefined}
                        turnMeta={at() === copy() ? turnMetaEl() : undefined}
                        settled={at() < props.message.content.length - 1}
                        defaultOpen={item.type === "tool" ? defaultOpen(item.name) : undefined}
                        reasoningDisplay={displaySettings().reasoningDisplay}
                        actions={props.actions}
                        loadedFiles={item.type === "tool" ? props.instructionFiles?.(item.id) : undefined}
                        errorAction={errorAction}
                      />
                    )}
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
        <Show when={props.onViewTurnChanges && lastChunk() && turnFiles().length > 0}>
          <div class="vscode-session-turn-diffs" data-component="session-turn">
            <button
              type="button"
              class="vscode-session-turn-diffs-trigger"
              onClick={() => props.onViewTurnChanges?.()}
              aria-label={language.t("ui.sessionReview.change.modified")}
            >
              <span data-slot="session-turn-diffs-label">{language.t("ui.sessionReview.change.modified")}</span>
              <span data-slot="session-turn-diffs-count">
                {turnFiles().length}{" "}
                {language.t(turnFiles().length === 1 ? "ui.common.file.one" : "ui.common.file.other")}
              </span>
              <span data-slot="session-turn-diffs-meta">
                <DiffChanges changes={turnFiles()} variant="bars" />
              </span>
              <span data-slot="session-turn-diffs-chevron" aria-hidden="true">
                <Icon name="chevron-right" size="small" />
              </span>
            </button>
          </div>
        </Show>
        {/* A step the user stopped is not a failure: its partial output stays and the run continues or ends. */}
        <Show when={lastChunk() && props.message.error?.type !== "aborted" ? props.message.error : undefined}>
          {(error) => <ErrorCard error={error()} />}
        </Show>
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
        <div class="error-card-message">{readableMessage(props.error, language.t)}</div>
      </div>
      <Collapsible variant="ghost">
        <Collapsible.Trigger class="error-details-trigger">
          <span>{language.t("error.details.show")}</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <ErrorDetails error={props.error} />
        </Collapsible.Content>
      </Collapsible>
    </Card>
  )
}
