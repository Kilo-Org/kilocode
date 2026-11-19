import { describe, expect, it } from "bun:test"
import { Schema } from "effect"
import { KiloHostedRpc } from "../../src/kilocode/hosted.js"
import { SessionMessage } from "../../src/session-message.js"

describe("hosted RPC", () => {
  const create = { scope: "opaque", agent: { mode: "code", model: "vendor/model" }, operationKey: crypto.randomUUID() }
  const messageID = SessionMessage.ID.create()

  it("admits empty and idempotent prompted workspace creation only", () => {
    expect(Schema.is(KiloHostedRpc.Create)(create)).toBe(true)
    expect(Schema.is(KiloHostedRpc.Create)({ ...create, messageID, prompt: "go" })).toBe(true)
    for (const bad of [
      { messageID },
      { prompt: "go" },
      { prompt: "", messageID },
      { messageID: "local", prompt: "go" },
      { operationKey: "unstable" },
      { branch: "-C" },
    ]) {
      expect(Schema.is(KiloHostedRpc.Create)({ ...create, ...bad })).toBe(false)
    }
    expect(Schema.encodeSync(KiloHostedRpc.Create)({ ...create, branch: undefined })).toEqual(create)
  })

  it("requires an explicit provider, workspace, account scope and session for routing", () => {
    const target = { scope: "scope", providerID: "kilo-cloud", workspaceID: "ws", sessionID: "ses_cloud" }
    expect(Schema.is(KiloHostedRpc.Target)(target)).toBe(true)
    for (const invalid of [
      { scope: "" },
      { providerID: "local" },
      { workspaceID: "../other" },
      { sessionID: "?local" },
    ]) {
      expect(Schema.is(KiloHostedRpc.Target)({ ...target, ...invalid })).toBe(false)
    }
  })

  it("validates native wire messages and the bounded infrastructure vocabulary", () => {
    const user = { type: "user", id: "msg_cloud", text: "hello", time: { created: 123 } }
    const step = { step: "cloning", status: "completed" }
    const snapshot = {
      connection: "sleeping",
      status: "unknown",
      messages: [user],
      questions: [],
      permissions: [],
      progress: { steps: [step] },
    }
    expect(Schema.is(KiloHostedRpc.Snapshot)(snapshot)).toBe(true)
    expect(
      Schema.is(KiloHostedRpc.Snapshot)({
        ...snapshot,
        connection: "preparing",
        progress: { phase: "preparing", step: "cloning", steps: [] },
      }),
    ).toBe(true)
    expect(Schema.is(KiloHostedRpc.Progress)({ step: "arbitrary command", steps: [] })).toBe(false)
    expect(Schema.is(KiloHostedRpc.Message)({ ...user, time: { created: "now" } })).toBe(false)
    expect(Schema.is(KiloHostedRpc.Progress)({ steps: [{ ...step, step: "untrusted command" }] })).toBe(false)
    expect(Schema.is(KiloHostedRpc.Progress)({ steps: Array(15).fill(step) })).toBe(false)
  })
})
