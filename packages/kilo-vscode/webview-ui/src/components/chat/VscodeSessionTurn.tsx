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
import { UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { Icon } from "@kilocode/kilo-ui/icon"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useFileComponent } from "@kilocode/kilo-ui/context/file"
import { normalize } from "@kilocode/kilo-ui/session-diff"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { AssistantMessage } from "./AssistantMessage"
import type {
  AssistantMessage as SDKAssistantMessage,
  Message as SDKMessage,
  Part as SDKPart,
  SnapshotFileDiff,
} from "@kilocode/sdk/v2"
import { ErrorDisplay } from "./ErrorDisplay"
import { useServer } from "../../context/server"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"

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

interface VscodeSessionTurnProps {
  sessionID: string
  messageID: string
  queued?: boolean
}

export const VscodeSessionTurn: Component<VscodeSessionTurnProps> = (props) => {
  const data = useData()
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  const server = useServer()
  const session = useSession()
  const language = useLanguage()

  const emptyMessages: SDKMessage[] = []
  const emptyParts: SDKPart[] = []
  const emptyDiffs: SnapshotFileDiff[] = []

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

  // Diffs from message summary
  const diffs = createMemo(() => {
    const rawDiffs = (message() as unknown as { summary?: { diffs?: unknown[] } } | undefined)?.summary?.diffs
    if (!rawDiffs?.length) return emptyDiffs
    const seen = new Set<string>()
    return (rawDiffs as SnapshotFileDiff[])
      .reduceRight<SnapshotFileDiff[]>((result, diff) => {
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
          <div
            class="vscode-session-turn-user"
            data-revert-disabled={
              assistantMessages().length > 0 && !session.revert() && session.status() !== "idle" ? "" : undefined
            }
            title={
              assistantMessages().length > 0 && !session.revert() && session.status() !== "idle"
                ? language.t("revert.disabled.agentBusy")
                : undefined
            }
          >
            <UserMessageDisplay
              message={msg() as unknown as Parameters<typeof UserMessageDisplay>[0]["message"]}
              parts={parts() as unknown as Parameters<typeof UserMessageDisplay>[0]["parts"]}
              interrupted={interrupted()}
              queued={props.queued}
              onRevert={
                assistantMessages().length > 0 && !session.revert()
                  ? () => {
                      if (session.status() !== "idle") return
                      session.revertSession(props.messageID)
                    }
                  : undefined
              }
            />
          </div>

          {/* Assistant parts — flat list, no context grouping */}
          <Show when={assistantMessages().length > 0}>
            <div class="vscode-session-turn-assistant">
              <For each={assistantMessages()}>
                {(msg) => <AssistantMessage message={msg} showAssistantCopyPartID={showAssistantCopyPartID()} />}
              </For>
            </div>
          </Show>

          {/* Diff summary — shown after completion */}
          <Show when={diffs().length > 0 && server.gitInstalled()}>
            <div class="vscode-session-turn-diffs" data-component="session-turn">
              <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
                <Collapsible.Trigger>
                  <div data-component="session-turn-diffs-trigger">
                    <div data-slot="session-turn-diffs-title">
                      <span data-slot="session-turn-diffs-label">{i18n.t("ui.sessionReview.change.modified")}</span>{" "}
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
                                        component={fileComponent}
                                        mode="diff"
                                        fileDiff={normalize(diff).fileDiff}
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

          {/* Error handling */}
          <Show when={error()}>
            <ErrorDisplay error={error()!} onLogin={server.startLogin} />
          </Show>
        </div>
      )}
    </Show>
  )
}
