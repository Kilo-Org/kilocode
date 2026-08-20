import { Window } from "happy-dom"
import type { PermissionRequest } from "../../webview-ui/src/types/messages"

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
  // Stub the VS Code webview API so LanguageProvider can resolve its VSCodeContext
  // without a real extension host.
  acquireVsCodeApi: () => ({
    postMessage: () => undefined,
    getState: () => undefined,
    setState: () => undefined,
  }),
})

const { render } = await import("solid-js/web")
const { ModeSwitchPermissionCard } = await import("../../webview-ui/src/components/chat/ModeSwitchCard")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
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
      <VSCodeProvider>
        <LanguageProvider>
          <ModeSwitchPermissionCard
            request={permission}
            details={details}
            responding={false}
            onDecide={(...args) => calls.push(args)}
          />
        </LanguageProvider>
      </VSCodeProvider>
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
      <VSCodeProvider>
        <LanguageProvider>
          <ModeSwitchPermissionCard
            request={permission}
            details={details}
            responding
            onDecide={() => {
              throw new Error("Responding card accepted a duplicate action")
            }}
          />
        </LanguageProvider>
      </VSCodeProvider>
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
