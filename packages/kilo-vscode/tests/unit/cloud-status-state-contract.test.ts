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
  it("mirrors the extension-to-webview message and public status shape", () => {
    for (const source of [extension, messages]) {
      expect(source).toContain('type: "agentManager.cloudStatus"')
      expect(source).toContain('type: "agentManager.cloudMessageFailed"')
      expect(source).toContain("sessionID: string")
      expect(source).toContain("cloudStatus:")
    }

    expect(messages).toContain('type: "preparing" | "ready" | "finalizing" | "error"')
    for (const step of [
      "disk_check",
      "workspace_setup",
      "cloning",
      "branch",
      "devcontainer_setup",
      "setup_commands",
      "kilo_server",
      "kilo_session",
      "ready",
      "failed",
    ]) {
      expect(messages).toContain(`| "${step}"`)
    }
    expect(extension).toContain("| CloudStatusMessage")
    expect(extension).toContain("| CloudMessageFailedMessage")
    expect(messages).toContain("| AgentManagerCloudStatusMessage")
    expect(messages).toContain("| AgentManagerCloudMessageFailedMessage")
  })

  it("routes cloud status messages before the main extension message switch", () => {
    const route = section(session, "  function routeCloudStatusMessage(", "  function handleExtensionMessage(")
    const handler = section(session, "  function handleExtensionMessage(", "  // Handle messages from extension")

    expect(route).toContain('message.type === "agentManager.cloudSessionsPending"')
    expect(route).toContain('message.type === "agentManager.cloudStatus"')
    expect(route).toContain('message.type === "agentManager.cloudMessageFailed"')
    expect(handler).toContain("routeCloudStatusMessage(message)")
    expect(handler).not.toContain('case "agentManager.cloudSessionsPending"')
    expect(handler).not.toContain('case "agentManager.cloudStatus"')
  })

  it("keeps replace-only per-session status separate and exposes an accessor", () => {
    expect(session).toContain(
      "const [cloudStatusMap, setCloudStatusMap] = createSignal<Record<string, AgentManagerCloudStatus>>({})",
    )
    expect(session).toContain("setCloudStatusMap((prev) => ({ ...prev, [sessionID]: status }))")
    expect(session).toContain("cloudStatus: (sessionID?: string) => AgentManagerCloudStatus | undefined")
    expect(session).toContain("cloudStatus,")
  })

  it("keeps a sanitized pre-delivery failure per retained cloud session", () => {
    expect(session).toContain(
      "const [cloudFailureMap, setCloudFailureMap] = createSignal<Record<string, AgentManagerCloudMessageFailure>>({})",
    )
    expect(session).toContain(
      "cloudMessageFailure: (sessionID?: string) => AgentManagerCloudMessageFailure | undefined",
    )
    expect(session).toContain("setCloudFailureMap((prev) => ({ ...prev, [sessionID]: failure }))")
    expect(session).toContain("cloudMessageFailure,")
  })

  it("preserves delivery failure across reconnect and clears it on a newer send", () => {
    const pending = section(session, "  function handleCloudSessionsPending(", "  function detachCloudSession(")
    const send = section(session, "  function sendMessage(", "  function sendCommand(")

    expect(pending).not.toContain("clearCloudMessageFailure(id)")
    expect(send).toContain("if (isCloudSession(sid)) clearCloudMessageFailure(sid)")
  })

  it("ignores late status after detach and clears stale status only on a new attachment", () => {
    const attach = section(session, "  function attachCloudSession(", "  function clearCloudStatus(")
    const handler = section(session, "  function handleCloudStatus(", "  function handleCloudSessionsPending(")

    expect(handler).toContain("if (!retainedCloud.has(sessionID)) return")
    expect(attach).toContain("if (!retainedCloud.has(session.id)) {\n      clearCloudStatus(session.id)")
    expect(attach.indexOf("clearCloudStatus(session.id)")).toBeLessThan(attach.indexOf("retainedCloud.add(session.id)"))
  })

  it("clears visible status on ready, authoritative startup status, pending, deletion, and detach", () => {
    const status = section(session, "  function handleSessionStatus(", "  function handlePermissionRequest(")
    const handler = section(session, "  function handleCloudStatus(", "  function handleCloudSessionsPending(")
    const pending = section(session, "  function handleCloudSessionsPending(", "  function detachCloudSession(")
    const detach = section(session, "  function detachCloudSession(", "  function isCloudSession(")
    const deleted = section(session, "  function handleSessionDeleted(", "  // Splices the message")

    expect(status).toContain("if (pendingCloud().has(sessionID)) clearCloudStatus(sessionID)")
    expect(status).not.toContain("clearCloudMessageFailure(sessionID)")
    expect(handler).toContain('if (status.type === "ready")')
    expect(handler).toContain("clearCloudStatus(sessionID)")
    expect(pending).toContain("clearCloudStatus(id)")
    expect(pending).not.toContain("clearCloudMessageFailure(id)")
    expect(deleted).toContain("clearCloudStatus(sessionID)")
    expect(deleted).toContain("clearCloudMessageFailure(sessionID)")
    expect(detach).toContain("handleSessionDeleted(sessionID)")
  })
})
