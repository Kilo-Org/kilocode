/**
 * AssistantMessage component
 * Renders all parts of an assistant message as a flat list — no context grouping.
 * Unlike the upstream AssistantParts, this renders each read/glob/grep/list tool
 * individually for maximum verbosity in the VS Code sidebar context.
 *
 * Permissions and questions with a tool context are rendered inline with their
 * tool call rather than in the bottom dock.
 */

import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Part, PART_MAPPING } from "@kilocode/kilo-ui/message-part"
import { Button } from "@kilocode/kilo-ui/button"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart, Message as SDKMessage } from "@kilocode/sdk/v2"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { QuestionDock } from "./QuestionDock"

const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])

function isRenderable(part: SDKPart): boolean {
  if (part.type === "tool") {
    const tool = (part as SDKPart & { tool: string }).tool
    if (HIDDEN_TOOLS.has(tool)) return false
    const state = (part as SDKPart & { state: { status: string } }).state
    if (tool === "question" && (state.status === "pending" || state.status === "running")) return false
    return true
  }
  if (part.type === "text") return !!(part as SDKPart & { text: string }).text?.trim()
  if (part.type === "reasoning") return !!(part as SDKPart & { text: string }).text?.trim()
  return !!PART_MAPPING[part.type]
}

interface AssistantMessageProps {
  message: SDKAssistantMessage
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()
  const session = useSession()
  const language = useLanguage()

  const parts = createMemo(() => {
    const stored = data.store.part?.[props.message.id]
    if (!stored) return []
    return (stored as SDKPart[]).filter(isRenderable)
  })

  const id = () => session.currentSessionID()
  const permissions = () => session.permissions().filter((p) => p.sessionID === id() && p.tool)
  const questions = () => session.questions().filter((q) => q.sessionID === id() && q.tool)

  const permissionForPart = (part: SDKPart) => {
    if (part.type !== "tool") return undefined
    const callID = (part as SDKPart & { callID: string }).callID
    return permissions().find((p) => p.tool!.callID === callID && p.tool!.messageID === props.message.id)
  }

  // Questions linked to this message (rendered after the last part)
  const questionForMessage = () =>
    questions().find((q) => q.tool!.messageID === props.message.id)

  const [responding, setResponding] = createSignal(false)

  const decide = (permissionId: string, response: "once" | "always" | "reject") => {
    if (responding()) return
    setResponding(true)
    session.respondToPermission(permissionId, response)
    setResponding(false)
  }

  return (
    <>
      <For each={parts()}>
        {(part) => {
          const perm = () => permissionForPart(part)
          return (
            <Show when={PART_MAPPING[part.type]}>
              <div data-component="tool-part-wrapper" data-permission={!!perm()}>
                <Part
                  part={part}
                  message={props.message as SDKMessage}
                  showAssistantCopyPartID={props.showAssistantCopyPartID}
                  turnDurationMs={props.turnDurationMs}
                />
                <Show when={perm()} keyed>
                  {(p) => (
                    <div data-component="permission-prompt">
                      <Show when={p.patterns.length > 0}>
                        <div class="permission-dock-patterns">
                          <For each={p.patterns}>
                            {(pattern) => <code class="permission-dock-pattern">{pattern}</code>}
                          </For>
                        </div>
                      </Show>
                      <div data-slot="permission-actions">
                        <Button variant="ghost" size="small" onClick={() => decide(p.id, "reject")} disabled={responding()}>
                          {language.t("ui.permission.deny")}
                        </Button>
                        <Button variant="secondary" size="small" onClick={() => decide(p.id, "always")} disabled={responding()}>
                          {language.t("ui.permission.allowAlways")}
                        </Button>
                        <Button variant="primary" size="small" onClick={() => decide(p.id, "once")} disabled={responding()}>
                          {language.t("ui.permission.allowOnce")}
                        </Button>
                      </div>
                      <p data-slot="permission-hint">{language.t("ui.permission.sessionHint")}</p>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
          )
        }}
      </For>
      <Show when={questionForMessage()} keyed>
        {(req) => <QuestionDock request={req} />}
      </Show>
    </>
  )
}
