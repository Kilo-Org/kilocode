/**
 * VscodeSessionTurn component
 * Custom replacement for the upstream SessionTurn, designed for the VS Code sidebar.
 *
 * Key differences from upstream SessionTurn:
 * - No "Gathered context" grouping — each tool call is rendered individually
 * - Sub-agents are fully expanded inline via TaskToolExpanded
 * - No per-turn auto-scroll (MessageList handles it)
 * - Simpler flat structure without overflow containers
 */

import { Component, createMemo, For, Show, createSignal, createEffect, on } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Message, UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Card } from "@kilocode/kilo-ui/card"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useDiffComponent } from "@kilocode/kilo-ui/context/diff"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { AssistantMessage } from "./AssistantMessage"
import type {
  AssistantMessage as SDKAssistantMessage,
  Message as SDKMessage,
  Part as SDKPart,
  FileDiff,
} from "@kilocode/sdk/v2"
function getDirectory(path: string): string {
  const sep = path.includes("/") ? "/" : "\\"
  const idx = path.lastIndexOf(sep)
  return idx === -1 ? "" : path.slice(0, idx + 1)
}

function getFilename(path: string): string {
  const sep = path.includes("/") ? "/" : "\\"
  const idx = path.lastIndexOf(sep)
  return idx === -1 ? path : path.slice(idx + 1)
}

function unwrapError(message: string): string {
  const text = message.replace(/^Error:\s*/, "").trim()
  const tryParse = (v: string) => {
    try {
      return JSON.parse(v) as unknown
    } catch {
      return undefined
    }
  }
  const read = (v: string) => {
    const first = tryParse(v)
    if (typeof first !== "string") return first
    return tryParse(first.trim())
  }
  let json = read(text)
  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) json = read(text.slice(start, end + 1))
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return message
  const rec = json as Record<string, unknown>
  const err =
    rec.error && typeof rec.error === "object" && !Array.isArray(rec.error)
      ? (rec.error as Record<string, unknown>)
      : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }
  const msg = typeof rec.message === "string" ? rec.message : undefined
  if (msg) return msg
  const reason = typeof rec.error === "string" ? rec.error : undefined
  if (reason) return reason
  return message
}

interface VscodeSessionTurnProps {
  sessionID: string
  messageID: string
  lastUserMessageID?: string
}

export const VscodeSessionTurn: Component<VscodeSessionTurnProps> = (props) => {
  const data = useData()
  const i18n = useI18n()
  const diffComponent = useDiffComponent()

  const emptyMessages: SDKMessage[] = []
  const emptyParts: SDKPart[] = []
  const emptyDiffs: FileDiff[] = []

  const allMessages = createMemo(() => {
    const msgs = data.store.message?.[props.sessionID]
    return (msgs ?? emptyMessages) as SDKMessage[]
  })

  const message = createMemo(() => {
    return allMessages().find((m) => m.id === props.messageID && m.role === "user") as
      | (SDKMessage & { role: "user" })
      | undefined
  })

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return (data.store.part?.[msg.id] ?? emptyParts) as SDKPart[]
  })

  const messageIndex = createMemo(() => {
    const msgs = allMessages()
    return msgs.findIndex((m) => m.id === props.messageID)
  })

  const assistantMessages = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return [] as SDKAssistantMessage[]
    const msgs = allMessages()
    const result: SDKAssistantMessage[] = []
    for (let i = index + 1; i < msgs.length; i++) {
      const m = msgs[i]
      if (!m) continue
      if (m.role === "user") break
      if (m.role === "assistant") result.push(m as SDKAssistantMessage)
    }
    return result
  })

  const interrupted = createMemo(() => assistantMessages().some((m) => m.error?.name === "MessageAbortedError"))

  const error = createMemo(
    () => assistantMessages().find((m) => m.error && m.error.name !== "MessageAbortedError")?.error,
  )

  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrapError(msg)
    if (msg === undefined || msg === null) return ""
    return unwrapError(String(msg))
  })

  // Diffs from message summary
  const diffs = createMemo(() => {
    const rawDiffs = (message() as unknown as { summary?: { diffs?: unknown[] } } | undefined)?.summary?.diffs
    if (!rawDiffs?.length) return emptyDiffs
    const seen = new Set<string>()
    return (rawDiffs as FileDiff[])
      .reduceRight<FileDiff[]>((result, diff) => {
        if (seen.has(diff.file)) return result
        seen.add(diff.file)
        result.push(diff)
        return result
      }, [])
      .reverse()
  })

  const [open, setOpen] = createSignal(false)
  const [expanded, setExpanded] = createSignal<string[]>([])

  createEffect(
    on(
      open,
      (value, prev) => {
        if (!value && prev) setExpanded([])
      },
      { defer: true },
    ),
  )

  // Last turn duration (for text part meta)
  const turnDurationMs = createMemo(() => {
    const start = (message() as unknown as { time?: { created?: number } } | undefined)?.time?.created
    if (typeof start !== "number") return undefined
    const end = assistantMessages().reduce<number | undefined>((max, item) => {
      const completed = item.time?.completed
      if (typeof completed !== "number") return max
      return max === undefined ? completed : Math.max(max, completed)
    }, undefined)
    if (typeof end !== "number" || end < start) return undefined
    return end - start
  })

  // Copy part ID — the last text part from the last assistant message
  const showAssistantCopyPartID = createMemo(() => {
    const msgs = assistantMessages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!msg) continue
      const msgParts = (data.store.part?.[msg.id] ?? emptyParts) as SDKPart[]
      for (let j = msgParts.length - 1; j >= 0; j--) {
        const part = msgParts[j]
        if (!part || part.type !== "text") continue
        if ((part as SDKPart & { text: string }).text?.trim()) return part.id
      }
    }
    return undefined
  })

  return (
    <Show when={message()}>
      {(msg) => (
        <div class="vscode-session-turn" data-message={msg().id}>
          {/* User message */}
          <div class="vscode-session-turn-user">
            <UserMessageDisplay
              message={msg() as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
              parts={parts() as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
              interrupted={interrupted()}
            />
          </div>

          {/* Assistant parts — flat list, no context grouping */}
          <Show when={assistantMessages().length > 0}>
            <div class="vscode-session-turn-assistant">
              <For each={assistantMessages()}>
                {(msg) => (
                  <AssistantMessage
                    message={msg}
                    showAssistantCopyPartID={showAssistantCopyPartID()}
                    turnDurationMs={turnDurationMs()}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* Diff summary — shown after completion */}
          <Show when={diffs().length > 0}>
            <div class="vscode-session-turn-diffs" data-component="session-turn">
              <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
                <Collapsible.Trigger>
                  <div data-component="session-turn-diffs-trigger">
                    <div data-slot="session-turn-diffs-title">
                      <span data-slot="session-turn-diffs-label">{i18n.t("ui.sessionReview.change.modified")}</span>
                      <span data-slot="session-turn-diffs-count">
                        {diffs().length} {i18n.t(diffs().length === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                      </span>
                      <div data-slot="session-turn-diffs-meta">
                        <DiffChanges changes={diffs()} variant="bars" />
                        <Collapsible.Arrow />
                      </div>
                    </div>
                  </div>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <Show when={open()}>
                    <div data-component="session-turn-diffs-content">
                      <Accordion
                        multiple
                        style={{ "--sticky-accordion-offset": "40px" }}
                        value={expanded()}
                        onChange={(value) => setExpanded(Array.isArray(value) ? value : value ? [value] : [])}
                      >
                        <For each={diffs()}>
                          {(diff) => {
                            const active = createMemo(() => expanded().includes(diff.file))
                            const [visible, setVisible] = createSignal(false)

                            createEffect(
                              on(
                                active,
                                (value) => {
                                  if (!value) {
                                    setVisible(false)
                                    return
                                  }
                                  requestAnimationFrame(() => {
                                    if (active()) setVisible(true)
                                  })
                                },
                                { defer: true },
                              ),
                            )

                            return (
                              <Accordion.Item value={diff.file}>
                                <StickyAccordionHeader>
                                  <Accordion.Trigger>
                                    <div data-slot="session-turn-diff-trigger">
                                      <span data-slot="session-turn-diff-path">
                                        <Show when={diff.file.includes("/")}>
                                          <span data-slot="session-turn-diff-directory">
                                            {`\u202A${getDirectory(diff.file)}\u202C`}
                                          </span>
                                        </Show>
                                        <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                                      </span>
                                      <div data-slot="session-turn-diff-meta">
                                        <span data-slot="session-turn-diff-changes">
                                          <DiffChanges changes={diff} />
                                        </span>
                                        <span data-slot="session-turn-diff-chevron">
                                          <Icon name="chevron-down" size="small" />
                                        </span>
                                      </div>
                                    </div>
                                  </Accordion.Trigger>
                                </StickyAccordionHeader>
                                <Accordion.Content>
                                  <Show when={visible()}>
                                    <div data-slot="session-turn-diff-view" data-scrollable>
                                      <Dynamic
                                        component={diffComponent}
                                        before={{ name: diff.file, contents: diff.before }}
                                        after={{ name: diff.file, contents: diff.after }}
                                      />
                                    </div>
                                  </Show>
                                </Accordion.Content>
                              </Accordion.Item>
                            )
                          }}
                        </For>
                      </Accordion>
                    </div>
                  </Show>
                </Collapsible.Content>
              </Collapsible>
            </div>
          </Show>

          {/* Error card */}
          <Show when={error()}>
            <Card variant="error" class="error-card">
              {errorText()}
            </Card>
          </Show>
        </div>
      )}
    </Show>
  )
}
