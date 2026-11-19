import { expect, test } from "bun:test"
import { Schema } from "effect"
import { KiloHostedRpc } from "../../src/kilocode/hosted.js"

test("only image-capable creation can start with an empty prompt; sibling-start refuses an uploaded handle", () => {
  const base = {
    scope: "scope",
    operationKey: crypto.randomUUID(),
    agent: { mode: "code", model: "model" },
    messageID: "msg_0123456789ab0123456789ABCD",
    prompt: "",
  }
  const handles = [crypto.randomUUID()]
  expect(Schema.is(KiloHostedRpc.Create)({ ...base, attachments: handles })).toBe(true)
  expect(Schema.is(KiloHostedRpc.Create)(base)).toBe(false)
  expect(Schema.is(KiloHostedRpc.Create)({ ...base, attachments: [], prompt: "go" })).toBe(false)
  expect(Schema.is(KiloHostedRpc.Start)({ ...base, workspaceID: "ws", prompt: "go", attachments: handles })).toBe(false)
})
