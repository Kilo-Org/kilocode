import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..")
const extension = readFileSync(join(ROOT, "src", "agent-manager", "types.ts"), "utf8")
const messages = readFileSync(join(ROOT, "webview-ui", "src", "types", "messages", "extension-messages.ts"), "utf8")
const session = readFileSync(join(ROOT, "webview-ui", "src", "context", "session.tsx"), "utf8")

function section(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end))
}

describe("Cloud Agent visible status contract", () => {
  it("mirrors cloud progress and delivery failures across the webview boundary", () => {
    for (const source of [extension, messages]) {
      expect(source).toContain('type: "agentManager.cloudStatus"')
      expect(source).toContain('type: "agentManager.cloudMessageFailed"')
      expect(source).toContain("sessionID: string")
      expect(source).toContain("cloudStatus:")
    }

    expect(messages).toContain('type: "preparing" | "ready" | "finalizing" | "error"')
    expect(extension).toContain("| CloudStatusMessage")
    expect(extension).toContain("| CloudMessageFailedMessage")
    expect(messages).toContain("| AgentManagerCloudStatusMessage")
    expect(messages).toContain("| AgentManagerCloudMessageFailedMessage")
  })

  it("routes cloud state before the main extension message switch", () => {
    const route = section(session, "  function routeCloudStatusMessage(", "  function handleExtensionMessage(")
    const handler = section(session, "  function handleExtensionMessage(", "  // Handle messages from extension")

    expect(route).toContain('message.type === "agentManager.cloudSessionsPending"')
    expect(route).toContain('message.type === "agentManager.cloudStatus"')
    expect(route).toContain('message.type === "agentManager.cloudMessageFailed"')
    expect(handler).toContain("routeCloudStatusMessage(message)")
    expect(handler).not.toContain('case "agentManager.cloudSessionsPending"')
    expect(handler).not.toContain('case "agentManager.cloudStatus"')
  })

  it("keeps replace-only progress and delivery failure state per retained session", () => {
    expect(session).toContain(
      "const [cloudStatusMap, setCloudStatusMap] = createSignal<Record<string, AgentManagerCloudStatus>>({})",
    )
    expect(session).toContain("setCloudStatusMap((prev) => ({ ...prev, [sessionID]: status }))")
    expect(session).toContain("cloudStatus: (sessionID?: string) => AgentManagerCloudStatus | undefined")
    expect(session).toContain(
      "const [cloudFailureMap, setCloudFailureMap] = createSignal<Record<string, AgentManagerCloudMessageFailure>>({})",
    )
    expect(session).toContain(
      "cloudMessageFailure: (sessionID?: string) => AgentManagerCloudMessageFailure | undefined",
    )
    expect(session).toContain("setCloudFailureMap((prev) => ({ ...prev, [sessionID]: failure }))")
  })

  it("preserves delivery failure across reconnect and clears it on a newer send", () => {
    const pending = section(session, "  function handleCloudSessionsPending(", "  function detachCloudSession(")
    const send = section(session, "  function sendMessage(", "  function sendCommand(")

    expect(pending).not.toContain("clearCloudMessageFailure(id)")
    expect(send).toContain("if (isCloudSession(scope)) clearCloudMessageFailure(scope)")
  })

  it("ignores late progress after detach and clears stale state on a new attachment", () => {
    const attach = section(session, "  function attachCloudSession(", "  function clearCloudStatus(")
    const handler = section(session, "  function handleCloudStatus(", "  function clearCloudMessageFailure(")

    expect(handler).toContain("if (!retainedCloud.has(sessionID)) return")
    expect(attach).toContain("if (!retainedCloud.has(session.id)) {")
    expect(attach).toContain("clearCloudStatus(session.id)")
    expect(attach).toContain("clearCloudMessageFailure(session.id)")
    expect(attach.indexOf("clearCloudStatus(session.id)")).toBeLessThan(attach.indexOf("retainedCloud.add(session.id)"))
  })

  it("unlocks hydration on messagesLoaded without hiding cloud progress", () => {
    const loaded = section(session, "  function handleMessagesLoaded(", "  function handleMessageCreated(")
    const status = section(session, "  function handleSessionStatus(", "  function handlePermissionRequest(")

    expect(loaded).toContain("if (retainedCloud.has(sessionID)) {")
    expect(loaded).not.toContain("clearCloudStatus(sessionID)")
    expect(loaded).toContain("next.delete(sessionID)")
    expect(status).not.toContain("clearCloudStatus")
    expect(status).not.toContain("setPendingCloud")
  })

  it("clears visible progress on ready, pending, deletion, and detach", () => {
    const handler = section(session, "  function handleCloudStatus(", "  function clearCloudMessageFailure(")
    const pending = section(session, "  function handleCloudSessionsPending(", "  function detachCloudSession(")
    const detach = section(session, "  function detachCloudSession(", "  function isCloudSession(")
    const deleted = section(session, "  function handleSessionDeleted(", "  // Splices the message")

    expect(handler).toContain('if (status.type === "ready")')
    expect(handler).toContain("clearCloudStatus(sessionID)")
    expect(pending).toContain("clearCloudStatus(id)")
    expect(deleted).toContain("clearCloudStatus(sessionID)")
    expect(deleted).toContain("clearCloudMessageFailure(sessionID)")
    expect(detach).toContain("handleSessionDeleted(sessionID)")
  })
})
