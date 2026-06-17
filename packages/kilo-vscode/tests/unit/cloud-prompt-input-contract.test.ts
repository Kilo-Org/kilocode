import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const WEBVIEW = join(__dirname, "..", "..", "webview-ui", "src")
const ROOT = join(WEBVIEW, "components", "chat")
const cloud = readFileSync(join(ROOT, "CloudPromptInput.tsx"), "utf8")
const local = readFileSync(join(ROOT, "PromptInput.tsx"), "utf8")
const chat = readFileSync(join(ROOT, "ChatView.tsx"), "utf8")
const session = readFileSync(join(WEBVIEW, "context", "session.tsx"), "utf8")
const messages = readFileSync(join(WEBVIEW, "types", "messages", "extension-messages.ts"), "utf8")
const styles = readFileSync(join(WEBVIEW, "styles", "prompt-input.css"), "utf8")

function section(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end))
}

const loaded = section(session, "  function handleMessagesLoaded(", "  function handleMessageCreated(")
const status = section(session, "  function handleSessionStatus(", "  function handlePermissionRequest(")
const send = section(session, "  function sendMessage(", "  function sendCommand(")
const abort = section(session, "  function abort(", "  function compact(")

describe("CloudPromptInput walking-skeleton contract", () => {
  it("is a plain-text composer with no slash, model, or mode controls", () => {
    expect(cloud).toContain("session.sendMessage(message)")
    for (const forbidden of [
      "ModelSelector",
      "ModeSwitcher",
      "useSlashCommand",
      "sendCommand",
      "selectedAgent",
      "providerID",
      "modelID",
    ]) {
      expect(cloud).not.toContain(forbidden)
    }
  })

  it("restores rejected text and keeps drafts isolated by cloud tab", () => {
    expect(cloud).toContain('message.type !== "sendMessageFailed"')
    expect(cloud).toContain("message.sessionID !== sid()")
    expect(cloud).toContain("setText(message.text)")
    expect(cloud).toContain("drafts.set(key(), message.text)")
  })

  it("stays locked while pending and unlocks only after messagesLoaded", () => {
    expect(cloud).toContain("const pending = () => !session.isCloudSessionHydrated(sid())")
    expect(cloud).toContain('classList={{ "prompt-input--disabled": !server.isConnected() || pending() }}')
    expect(cloud).toContain("disabled={pending()}")
    expect(loaded).toContain("if (retainedCloud.has(sessionID)) {")
    expect(loaded).not.toContain("clearCloudStatus(sessionID)")
    expect(loaded).toContain("next.delete(sessionID)")
    expect(status).not.toContain("setPendingCloud")
  })

  it("renders display-only localized cloud progress", () => {
    expect(cloud).toContain("session.cloudStatus(sid())")
    expect(cloud).toContain("cloudStatusKey")
    expect(cloud).toContain('role="status"')
    expect(cloud).toContain('aria-live="polite"')
    expect(cloud).toContain('<Spinner class="cloud-status-spinner" />')
    expect(styles).toContain(".cloud-status-strip")
    expect(styles).toContain(".cloud-status-strip--error")
  })

  it("does not import local-only prompt features", () => {
    for (const name of [
      "useFileMention",
      "useImageAttachments",
      "useTerminalContext",
      "useGitChangesContext",
      "ThinkingSelector",
      "SpeechToText",
    ]) {
      expect(cloud).not.toContain(name)
    }
  })
})

describe("cloud session transport contract", () => {
  it("relocks retained tabs after transport invalidation", () => {
    expect(messages).toContain('type: "agentManager.cloudSessionsPending"')
    expect(messages).toContain("sessionIDs: string[]")
    expect(session).toContain('message.type === "agentManager.cloudSessionsPending"')
    expect(session).toContain("handleCloudSessionsPending(message.sessionIDs)")
    expect(session).toContain("if (retainedCloud.has(id)) next.add(id)")
  })

  it("strips model, mode, files, and review overrides from cloud sends", () => {
    expect(send).toContain("const cloud = isCloudSession(sid)")
    expect(send).toContain("providerID: cloud ? undefined : providerID")
    expect(send).toContain("modelID: cloud ? undefined : modelID")
    expect(send).toContain("const agent = cloud ? undefined : promptAgent(scope)")
    expect(send).toContain("variant: cloud ? undefined : currentVariant(scope)")
    expect(send).toContain("files: cloud ? undefined : files")
    expect(send).toContain("review: cloud ? undefined : review")
  })

  it("routes pending cloud aborts directly while the parent Escape handler stays inert", () => {
    expect(chat).toContain("if (props.cloud && !session.isCloudSessionHydrated(id())) return")
    expect(abort).toContain("isCloudSession(sessionID) && !isCloudSessionHydrated(sessionID)")
    expect(abort).toContain('vscode.postMessage({ type: "abort", sessionID })')
  })
})

describe("PromptInput local composer isolation", () => {
  it("does not import or branch on cloud mode", () => {
    expect(local).not.toContain("CloudPromptInput")
    expect(local).not.toContain("props.cloud")
    expect(local).not.toContain("cloud?:")
  })
})
