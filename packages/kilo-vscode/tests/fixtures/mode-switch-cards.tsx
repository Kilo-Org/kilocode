import { Window } from "happy-dom"
import type { PermissionRequest, QuestionRequest } from "../../webview-ui/src/types/messages"

const window = new Window()
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  },
})

const { render } = await import("solid-js/web")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { ModeSwitchDeniedCard, ModeSwitchPermissionCard } = await import(
  "../../webview-ui/src/components/chat/ModeSwitchCard"
)
const { ToolRegistry } = await import("@kilocode/kilo-ui/message-part")
const { registerVscodeToolOverrides } = await import("../../webview-ui/src/components/chat/VscodeToolOverrides")

const details = { source: "code", target: "debug", reason: "Investigate the failing request" }
const permission: PermissionRequest = {
  id: "permission-1",
  sessionID: "session-1",
  toolName: "mode_switch",
  args: details,
  patterns: ["*"],
  always: ["*"],
}
const question: QuestionRequest = {
  id: "question-1",
  sessionID: "session-1",
  tool: { messageID: "message-1", callID: "call-1" },
  questions: [
    {
      header: "Mode switch denied",
      question:
        "Switching from code to debug was denied. Reason: Investigate the failing request. Continue in code or cancel this task?",
      options: [
        { label: "Continue current mode", description: "Resume the same task in code.", mode: "code" },
        { label: "Cancel task", description: "Stop without another model step." },
      ],
      custom: false,
    },
  ],
}

function button(root: HTMLElement, label: string) {
  const result = Array.from(root.querySelectorAll("button")).find((item) => item.textContent?.trim() === label)
  if (!result) throw new Error(`Missing button: ${label}`)
  return result
}

function permissionDecision(label: string) {
  const root = document.createElement("div")
  document.body.append(root)
  const calls: unknown[][] = []
  const dispose = render(
    () => (
      <ModeSwitchPermissionCard
        request={permission}
        details={details}
        responding={false}
        onDecide={(...args) => calls.push(args)}
      />
    ),
    root,
  )
  if (root.textContent?.includes("Always allow")) {
    throw new Error("Permission card rendered an in-card auto-approval control")
  }
  if (root.querySelector('[data-slot="mode-switch-header"] svg')) {
    throw new Error("Permission card rendered a decorative title icon")
  }
  button(root, label).click()
  const disabled = Array.from(root.querySelectorAll("button")).every((item) => item.disabled)
  dispose()
  root.remove()
  return { calls, disabled }
}

const once = permissionDecision("Switch to debug")
if (JSON.stringify(once.calls) !== JSON.stringify([["once", [], []]]) || !once.disabled) {
  throw new Error(`Unexpected switch decision: ${JSON.stringify(once)}`)
}

const stay = permissionDecision("Stay in code")
if (JSON.stringify(stay.calls) !== JSON.stringify([["reject", [], []]]) || !stay.disabled) {
  throw new Error(`Unexpected stay decision: ${JSON.stringify(stay)}`)
}

{
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () => (
      <ModeSwitchPermissionCard
        request={permission}
        details={details}
        responding
        onDecide={() => {
          throw new Error("Responding card accepted a duplicate action")
        }}
      />
    ),
    root,
  )
  if (!root.textContent?.includes("Switching to debug…")) throw new Error("Pending state was not visible")
  if (!Array.from(root.querySelectorAll("button")).every((item) => item.disabled)) {
    throw new Error("Pending state left an action enabled")
  }
  dispose()
  root.remove()
}

{
  registerVscodeToolOverrides()
  const component = ToolRegistry.render("mode_switch")
  if (!component) throw new Error("Mode switch transcript renderer was not registered")

  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(
    () =>
      component({
        input: { target: "plan", reason: "User requested Plan Mode" },
        metadata: {
          status: "switched",
          source: "code",
          target: "plan",
          reason: "User requested Plan Mode",
        },
        status: "completed",
        tool: "mode_switch",
      }),
    root,
  )
  const title = root.querySelector('[data-slot="mode-switch-event-title"]')
  const reason = root.querySelector('[data-slot="mode-switch-event-reason"]')
  if (title?.textContent !== "Mode switched: code → plan") {
    throw new Error(`Unexpected transcript title: ${title?.textContent}`)
  }
  if (reason?.textContent !== "User requested Plan Mode") {
    throw new Error(`Unexpected transcript reason: ${reason?.textContent}`)
  }
  if (title?.parentElement !== reason?.parentElement || title?.nextElementSibling !== reason) {
    throw new Error("Transcript reason was not rendered as the second line")
  }
  dispose()
  root.remove()
}

function deniedDecision(label: string) {
  const root = document.createElement("div")
  document.body.append(root)
  const calls: Array<{ id: string; answers: string[][] }> = []
  const session = {
    questionErrors: () => new Set<string>(),
    replyToQuestion: (id: string, answers: string[][]) => calls.push({ id, answers }),
  }
  const dispose = render(
    () => (
      <SessionContext.Provider value={session as never}>
        <ModeSwitchDeniedCard request={question} details={details} />
      </SessionContext.Provider>
    ),
    root,
  )
  if (root.textContent?.includes("Submit") || root.textContent?.includes("Dismiss")) {
    throw new Error("Denied mode switch rendered redundant generic actions")
  }
  button(root, label).click()
  const disabled = Array.from(root.querySelectorAll("button")).every((item) => item.disabled)
  dispose()
  root.remove()
  return { calls, disabled }
}

const continued = deniedDecision("Continue in code")
if (
  JSON.stringify(continued.calls) !== JSON.stringify([{ id: "question-1", answers: [["Continue current mode"]] }]) ||
  !continued.disabled
) {
  throw new Error(`Unexpected continue decision: ${JSON.stringify(continued)}`)
}

const cancelled = deniedDecision("Cancel task")
if (
  JSON.stringify(cancelled.calls) !== JSON.stringify([{ id: "question-1", answers: [["Cancel task"]] }]) ||
  !cancelled.disabled
) {
  throw new Error(`Unexpected cancel decision: ${JSON.stringify(cancelled)}`)
}
