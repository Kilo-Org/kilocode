/**
 * AssistantMessage component
 * Renders assistant parts in model-step groups with checkpoint boundaries.
 * Unlike the upstream AssistantParts, this renders each read/glob/grep/list tool
 * individually for maximum verbosity in the VS Code sidebar context.
 *
 * Active questions render inline via QuestionDock; permissions are in the bottom dock.
 */

import { Component, For, Show, createMemo } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Part, PART_MAPPING, ToolRegistry } from "@kilocode/kilo-ui/message-part"
import type { MessageFeedbackControls } from "@kilocode/kilo-ui/message-part"
import type {
  AssistantMessage as SDKAssistantMessage,
  Part as SDKPart,
  Message as SDKMessage,
  ToolPart,
} from "@kilocode/sdk/v2"
import { useData } from "@kilocode/kilo-ui/context/data"
import { useSession } from "../../context/session"
import { useDisplay } from "../../context/display"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import { snapshotProgress } from "../../context/session-utils"
import { planDisplayPath } from "../../utils/plan-path"
import { QuestionDock } from "./QuestionDock"
import { SuggestBar } from "./SuggestBar"
import { CheckpointLine } from "./CheckpointLine"
import {
  checkpointBoundary,
  checkpointLayout,
  stableCheckpointLayout,
  type CheckpointLayout,
} from "./checkpoint-groups"
import { RevertBanner } from "./RevertBanner"
import {
  UPSTREAM_SUPPRESSED_TOOLS,
  isKiloToolRenderable,
  matchToolRequest,
} from "./assistant-message-routing"


/** Extract plan path from a completed plan_exit tool part. */
function planExitInfo(part: SDKPart): { plan: string } | undefined {
  if (part.type !== "tool") return undefined
  const tp = part as unknown as ToolPart
  if (tp.tool !== "plan_exit") return undefined
  if (tp.state?.status !== "completed") return undefined
  const meta = (tp.state as { metadata?: Record<string, unknown> }).metadata ?? {}
  const plan = typeof meta.plan === "string" ? meta.plan : undefined
  if (!plan) return undefined
  return { plan }
}

function PlanExitCard(props: { part: ToolPart }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const info = createMemo(() => planExitInfo(props.part as unknown as SDKPart))
  const display = createMemo(() => {
    const i = info()
    if (!i) return ""
    return planDisplayPath(i.plan, server.workspaceDirectory())
  })
  const label = createMemo(() => {
    if (!info()) return ""
    return language.t("plan.exit.ready")
  })
  const open = (e: MouseEvent) => {
    e.preventDefault()
    const i = info()
    if (!i || !data.openFile) return
    data.openFile(i.plan)
  }
  return (
    <Show when={info()}>
      <div data-component="plan-exit-card">
        <span data-slot="plan-exit-label">{label()}</span>{" "}
        <a data-slot="plan-exit-link" href="#" onClick={open}>
          {display()}
        </a>
      </div>
    </Show>
  )
}

function isRenderable(part: SDKPart): boolean {
  if (part.type === "tool") return isKiloToolRenderable(part as ToolPart)
  if (part.type === "text") return !snapshotProgress(part) && !!(part as SDKPart & { text: string }).text?.trim()
  if (part.type === "reasoning") return !!(part as SDKPart & { text: string }).text?.trim()
  return !!PART_MAPPING[part.type]
}

interface AssistantMessageProps {
  message: SDKAssistantMessage
  showAssistantCopyPartID?: string | null
  feedback?: MessageFeedbackControls
}

interface RenderedPartProps {
  part: SDKPart
  message: SDKAssistantMessage
  showAssistantCopyPartID?: string | null
  feedback?: MessageFeedbackControls
}

type ToolStateProps = {
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
  status?: string
}

function TodoToolCard(props: { part: ToolPart }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = () => props.part.state as ToolStateProps
  return (
    <Show when={render}>
      {(renderFn) => (
        <Dynamic
          component={renderFn()}
          input={state()?.input ?? {}}
          metadata={state()?.metadata ?? {}}
          tool={props.part.tool}
          partID={props.part.id}
          callID={props.part.callID}
          output={state()?.output}
          status={state()?.status}
          defaultOpen
          reveal={false}
        />
      )}
    </Show>
  )
}

function BashToolCard(props: { part: ToolPart; defaultOpen: boolean }) {
  const render = ToolRegistry.render(props.part.tool)
  const state = () => props.part.state as ToolStateProps
  return (
    <Show when={render}>
      {(card) => (
        <Dynamic
          component={card() as unknown as Component<Record<string, unknown>>}
          input={state()?.input ?? {}}
          metadata={state()?.metadata ?? {}}
          partMetadata={props.part.metadata ?? {}}
          tool={props.part.tool}
          partID={props.part.id}
          callID={props.part.callID}
          output={state()?.output}
          status={state()?.status}
          defaultOpen={props.defaultOpen}
          animate
          reveal={state()?.status === "pending" || state()?.status === "running"}
        />
      )}
    </Show>
  )
}

const RenderedPart: Component<RenderedPartProps> = (props) => {
  const session = useSession()
  const display = useDisplay()
  const { config } = useConfig()
  const open = createMemo(() => config().terminal_command_display !== "collapsed")
  const todo = createMemo(
    () => props.part.type === "tool" && UPSTREAM_SUPPRESSED_TOOLS.has((props.part as ToolPart).tool),
  )
  const question = createMemo(() => matchToolRequest(props.part, "question", session.questions()))
  const suggestion = createMemo(() => matchToolRequest(props.part, "suggest", session.suggestions()))
  const bash = createMemo(() => {
    if (props.part.type !== "tool") return
    const part = props.part as ToolPart
    if (part.tool !== "bash" || part.state?.status === "error") return
    return part
  })
  const planExit = createMemo(() => {
    if (props.part.type !== "tool") return
    const part = props.part as ToolPart
    if (part.tool !== "plan_exit" || part.state?.status !== "completed") return
    return part
  })

  return (
    <Show when={todo() || question() || suggestion() || bash() || planExit() || PART_MAPPING[props.part.type]}>
      <div data-component="tool-part-wrapper" data-part-type={props.part.type}>
        <Show
          when={question()}
          fallback={
            <Show
              when={suggestion()}
              fallback={
                <Show
                  when={planExit()}
                  fallback={
                    <Show
                      when={bash()}
                      fallback={
                        <Show
                          when={todo()}
                          fallback={
                            <Part
                              part={props.part}
                              message={props.message as SDKMessage}
                              showAssistantCopyPartID={props.showAssistantCopyPartID}
                              reasoningAutoCollapse={display.reasoningAutoCollapse()}
                              feedback={props.feedback}
                              animate={
                                props.part.type === "tool" &&
                                ((props.part as ToolPart).state?.status === "pending" ||
                                  (props.part as ToolPart).state?.status === "running")
                              }
                            />
                          }
                        >
                          <TodoToolCard part={props.part as ToolPart} />
                        </Show>
                      }
                    >
                      {(part) => <BashToolCard part={part()} defaultOpen={open()} />}
                    </Show>
                  }
                >
                  {(part) => <PlanExitCard part={part()} />}
                </Show>
              }
            >
              {(request) => <SuggestBar request={request()} />}
            </Show>
          }
        >
          {(request) => <QuestionDock request={request()} />}
        </Show>
      </div>
    </Show>
  )
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const data = useData()
  const session = useSession()
  const vscode = useVSCode()
  const raw = createMemo(() => (data.store.part?.[props.message.id] ?? []) as SDKPart[])
  const boundary = createMemo(() => {
    const info = session.revert()
    if (info?.messageID !== props.message.id) return
    return info.partID
  })
  const layout = createMemo<CheckpointLayout>((prev) =>
    stableCheckpointLayout(checkpointLayout(checkpointBoundary(raw(), boundary())), prev),
  )
  const part = (value: SDKPart) => (
    <Show when={isRenderable(value)}>
      <RenderedPart
        part={value}
        message={props.message}
        showAssistantCopyPartID={props.showAssistantCopyPartID}
        feedback={props.feedback}
      />
    </Show>
  )
  const rewind = (start: SDKPart & { snapshot?: string }) => {
    session.rewindCheckpoint(props.message.id, start.id)
  }

  return (
    <>
      <For each={layout().preamble}>{part}</For>
      <For each={layout().groups}>
        {(group) => (
          <>
            <Show when={group.tools.length > 0}>
              <CheckpointLine
                snapshot={group.start.snapshot}
                busy={session.status() !== "idle"}
                parallel={group.parallel}
                tools={group.tools.length}
                loading={session.checkpointPending(props.message.id, group.start.id)}
                onRewind={() => rewind(group.start)}
                onViewDiff={
                  group.finish?.snapshot && group.start.snapshot
                    ? () =>
                        vscode.postMessage({
                          type: "openChanges",
                          messageId: props.message.id,
                          partId: group.start.id,
                        })
                    : undefined
                }
              />
            </Show>
            <For each={group.parts}>{part}</For>
          </>
        )}
      </For>
      <For each={layout().tail}>{part}</For>
      <Show when={boundary()}>
        <RevertBanner inline />
      </Show>
    </>
  )
}
