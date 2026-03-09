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
import { Dynamic } from "solid-js/web"
import { Part, PART_MAPPING, ToolRegistry } from "@kilocode/kilo-ui/message-part"
import { Button } from "@kilocode/kilo-ui/button"
import type { AssistantMessage as SDKAssistantMessage, Part as SDKPart, Message as SDKMessage, ToolPart } from "@kilocode/sdk/v2"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { QuestionDock } from "./QuestionDock"

// Tools that the upstream message-part renderer suppresses (returns null for).
// We render these ourselves via ToolRegistry when they have a pending permission
// or when they complete, so the user can see what the AI set up.
// We also use this set in ChatView to know NOT to block the prompt input for
// these tool permissions (since they're shown inline in the message stream).
export const UPSTREAM_SUPPRESSED_TOOLS = new Set(["todowrite", "todoread"])

function isRenderable(part: SDKPart, pendingPermissionCallIDs: Set<string>): boolean {
  if (part.type === "tool") {
    const tool = (part as SDKPart & { tool: string }).tool
    const state = (part as SDKPart & { state: { status: string } }).state
    if (UPSTREAM_SUPPRESSED_TOOLS.has(tool)) {
      const callID = (part as SDKPart & { callID: string }).callID
      // Show todo parts when waiting for permission (inline) or when completed (to show what happened)
      return pendingPermissionCallIDs.has(callID) || state.status === "completed"
    }
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

function TodoToolCard(props: { part: ToolPart }) {
  const render = ToolRegistry.render(props.part.tool)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = props.part.state as any
  return (
    <Show when={render}>
      {(renderFn) => (
        <Dynamic
          component={renderFn()}
          input={state?.input ?? {}}
          metadata={state?.metadata ?? {}}
          tool={props.part.tool}
          output={state?.output}
          status={state?.status}
          defaultOpen
        />
      )}
    </Show>
  )
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()
  const session = useSession()
  const language = useLanguage()

  const id = () => session.currentSessionID()
  const permissions = () => session.permissions().filter((p) => p.sessionID === id() && p.tool)
  const questions = () => session.questions().filter((q) => q.sessionID === id() && q.tool)

  const pendingPermissionCallIDs = createMemo(() => {
    const ids = new Set<string>()
    for (const p of permissions()) {
      if (p.tool?.messageID === props.message.id) ids.add(p.tool.callID)
    }
    return ids
  })

  const parts = createMemo(() => {
    const stored = data.store.part?.[props.message.id]
    if (!stored) return []
    return (stored as SDKPart[]).filter((part) => isRenderable(part, pendingPermissionCallIDs()))
  })

  const permissionForPart = (part: SDKPart) => {
    if (part.type !== "tool") return undefined
    const callID = (part as SDKPart & { callID: string }).callID
    return permissions().find((p) => p.tool!.callID === callID && p.tool!.messageID === props.message.id)
  }

  // Questions linked to this message (rendered after the last part)
  const questionForMessage = () => questions().find((q) => q.tool!.messageID === props.message.id)

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
          // Upstream PART_MAPPING["tool"] returns null for todowrite/todoread,
          // so we detect them here and render via ToolRegistry directly.
          const isUpstreamSuppressed = part.type === "tool" && UPSTREAM_SUPPRESSED_TOOLS.has((part as SDKPart & { tool: string }).tool)
          return (
            <Show when={isUpstreamSuppressed || PART_MAPPING[part.type]}>
              <div data-component="tool-part-wrapper" data-permission={!!perm()} data-part-type={part.type}>
                <Show
                  when={isUpstreamSuppressed}
                  fallback={
                    <Part
                      part={part}
                      message={props.message as SDKMessage}
                      showAssistantCopyPartID={props.showAssistantCopyPartID}
                      turnDurationMs={props.turnDurationMs}
                    />
                  }
                >
                  <TodoToolCard part={part as unknown as ToolPart} />
                </Show>
                <Show when={perm()} keyed>
                  {(p) => {
                    const isTodoPerm = UPSTREAM_SUPPRESSED_TOOLS.has(p.toolName)
                    // For todo tools: show the friendly operation description instead of raw patterns like '*'
                    // For other tools: extract a human-readable subject from the tool part's input
                    // The tool's state.input has filePath/pattern/etc from before execution started
                    const toolInput = part.type === "tool" ? ((part as SDKPart & { state: { input?: Record<string, unknown> } }).state?.input ?? {}) : {}
                    const subject = (() => {
                      const tool = p.toolName
                      if (tool === "read" || tool === "edit" || tool === "write" || tool === "multiedit") {
                        const fp = toolInput.filePath
                        if (typeof fp === "string") return fp.split("/").pop() || fp
                      }
                      if (tool === "grep" || tool === "glob") {
                        const pat = toolInput.pattern
                        if (typeof pat === "string") return pat
                      }
                      if (tool === "list") {
                        const dir = toolInput.path
                        if (typeof dir === "string") return dir
                      }
                      if (tool === "bash") {
                        const desc = toolInput.description
                        if (typeof desc === "string") return desc
                      }
                      if (tool === "webfetch") {
                        const url = toolInput.url
                        if (typeof url === "string") return url
                      }
                      if (tool === "websearch" || tool === "codesearch") {
                        const q = toolInput.query
                        if (typeof q === "string") return q
                      }
                      // Fall back to meaningful (non-wildcard) patterns from the permission request
                      const meaningful = p.patterns.filter((pat) => pat !== "*")
                      if (meaningful.length > 0) return meaningful[0]!.split("/").pop() || meaningful[0]!
                      return undefined
                    })()
                    return (
                    <div data-component="permission-prompt" onClick={(e: MouseEvent) => e.stopPropagation()}>
                      <Show when={!isTodoPerm && subject}>
                        <div class="permission-dock-patterns">
                          <code class="permission-dock-pattern">{subject}</code>
                        </div>
                      </Show>
                      <Show when={isTodoPerm}>
                        <p data-slot="permission-description">
                          {p.toolName === "todowrite"
                            ? language.t("settings.permissions.tool.todowrite.description")
                            : language.t("settings.permissions.tool.todoread.description")}
                        </p>
                      </Show>
                      <div data-slot="permission-actions">
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => decide(p.id, "reject")}
                          disabled={responding()}
                        >
                          {language.t("ui.permission.deny")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => decide(p.id, "always")}
                          disabled={responding()}
                        >
                          {language.t("ui.permission.allowAlways")}
                        </Button>
                        <Button
                          variant="primary"
                          size="small"
                          onClick={() => decide(p.id, "once")}
                          disabled={responding()}
                        >
                          {language.t("ui.permission.allowOnce")}
                        </Button>
                      </div>
                      <p data-slot="permission-hint">{language.t("ui.permission.sessionHint")}</p>
                    </div>
                    )
                  }}
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
