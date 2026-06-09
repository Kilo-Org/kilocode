import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const WEBVIEW = join(__dirname, "..", "..", "webview-ui", "src")
const ROOT = join(WEBVIEW, "components", "chat")
const cloud = readFileSync(join(ROOT, "CloudPromptInput.tsx"), "utf8")
const local = readFileSync(join(ROOT, "PromptInput.tsx"), "utf8")
const chat = readFileSync(join(ROOT, "ChatView.tsx"), "utf8")
const session = readFileSync(join(WEBVIEW, "context", "session.tsx"), "utf8")
const status = session.slice(
  session.indexOf("  function handleSessionStatus("),
  session.indexOf("  function handlePermissionRequest("),
)
const sendCommand = session.slice(session.indexOf("  function sendCommand("), session.indexOf("  function abort("))
const messages = readFileSync(join(WEBVIEW, "types", "messages", "extension-messages.ts"), "utf8")
const styles = readFileSync(join(WEBVIEW, "styles", "prompt-input.css"), "utf8")

describe("CloudPromptInput restricted composer contract", () => {
  it("constrains model selection to Kilo", () => {
    expect(cloud).toContain('<ModelSelector sessionID={sid} providerID="kilo" />')
  })

  it("sends plain text or discovered server commands with the selected Kilo model", () => {
    expect(cloud).toContain("const agent = session.selectedAgent(sid())")
    expect(cloud).toContain("useSlashCommand(vscode, undefined, { sessionID: sid })")
    expect(cloud).toContain("slash.onInput(value, target.selectionStart ?? value.length)")
    expect(cloud).toContain("slash.onKeyDown(event, textareaRef, setText, resize)")
    expect(cloud).toContain("const resolved = slash.resolve(message)")
    expect(cloud).toContain(
      "session.sendCommand(resolved.command.name, resolved.arguments, sel.providerID, sel.modelID)",
    )
    expect(cloud).toContain(
      "session.sendMessage(message, sel.providerID, sel.modelID, undefined, undefined, undefined, agent)",
    )
    expect(cloud).toContain('class="slash-command-dropdown"')
    expect(sendCommand).not.toContain("if (isCloudSession()) return")
  })

  it("restores failed send text", () => {
    expect(cloud).toContain('message.type !== "sendMessageFailed"')
    expect(cloud).toContain("setText(message.text)")
    expect(cloud).toContain("drafts.set(key(), message.text)")
  })

  it("keeps pending cloud status visibly disabled until hydration", () => {
    expect(cloud).toContain("const pending = () => !session.isCloudSessionHydrated(sid())")
    expect(cloud).toContain("!pending() &&")
    expect(cloud).toContain('classList={{ "prompt-input--disabled": !server.isConnected() || pending() }}')
    expect(cloud).toContain("disabled={pending()}")
    expect(cloud).toContain(
      '{pending() ? (\n            <Spinner class="chat-spinner-small" />\n          ) : busy() ? (',
    )
    expect(cloud).toContain('if (event.key === "Escape" && !pending() && busy()) {')
  })

  it("renders display-only localized cloud progress with polite live-region semantics", () => {
    expect(cloud).toContain("session.cloudStatus(sid())")
    expect(cloud).toContain("cloudStatusKey")
    expect(cloud).toContain('role="status"')
    expect(cloud).toContain('aria-live="polite"')
    expect(cloud).toContain('<Spinner class="cloud-status-spinner" />')
    expect(cloud).toContain('"cloud-status-strip--error": statusError()')
    expect(cloud).toContain("<Show when={!statusError()}>")
    expect(styles).toContain(".cloud-status-strip")
    expect(styles).toContain(".cloud-status-strip--error")
  })

  it("does not import local-only prompt features", () => {
    const forbidden = [
      "useFileMention",
      "useImageAttachments",
      "useTerminalContext",
      "useGitChangesContext",
      "ThinkingSelector",
      "SpeechToText",
    ]
    for (const name of forbidden) expect(cloud).not.toContain(name)
  })
})

describe("cloud session hydration contract", () => {
  it("marks only newly attached cloud tabs pending", () => {
    expect(session).toContain("if (!retainedCloud.has(session.id)) {")
    expect(session).toContain("setPendingCloud((prev) => new Set(prev).add(session.id))")
  })

  it("relocks listed tabs after authenticated transport invalidation", () => {
    expect(messages).toContain('type: "agentManager.cloudSessionsPending"')
    expect(messages).toContain("sessionIDs: string[]")
    expect(session).toContain('message.type === "agentManager.cloudSessionsPending"')
    expect(session).toContain("handleCloudSessionsPending(message.sessionIDs)")
    expect(session).toContain("if (retainedCloud.has(id)) next.add(id)")
  })

  it("unlocks attached tabs only after authoritative status and clears detached state", () => {
    expect(status).toContain("setStatusMap(sessionID, info)\n    if (retainedCloud.has(sessionID)) {")
    expect(status).toContain("next.delete(sessionID)")
    expect(session).toContain("retainedCloud.delete(sessionID)\n    setPendingCloud((prev) => {")
    expect(session).toContain("return !sessionID || !pendingCloud().has(sessionID)")
  })
})

describe("ChatView localhost recovery contract", () => {
  it("does not suppress StartupErrorBanner for cloud tabs", () => {
    expect(chat).toContain('<Show when={server.connectionState() === "error" && server.errorMessage()}>')
    expect(chat).not.toContain('when={!props.cloud && server.connectionState() === "error"')
  })

  it("does not abort a pending cloud tab from the parent Escape handler", () => {
    expect(chat).toContain("if (props.cloud && !session.isCloudSessionHydrated(id())) return")
  })
})

describe("PromptInput local composer isolation", () => {
  it("does not import or branch on cloud mode", () => {
    expect(local).not.toContain("CloudPromptInput")
    expect(local).not.toContain("props.cloud")
    expect(local).not.toContain("cloud?:")
  })
})
