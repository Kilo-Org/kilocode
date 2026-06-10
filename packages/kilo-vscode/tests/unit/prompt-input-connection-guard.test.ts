import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("PromptInput connection guard", () => {
  const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
  const src = readFileSync(path, "utf8")

  it("rechecks the connection after resolving async attachments and before clearing the draft", () => {
    const attachments = src.indexOf("const gitFile = await git.resolveAttachment")
    const guard = src.indexOf("if (isDisabled()) return", attachments)
    const send = src.indexOf("session.sendMessage(message", guard)
    const clear = src.indexOf("drafts.delete(key)", send)

    expect(attachments).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(attachments)
    expect(send).toBeGreaterThan(guard)
    expect(clear).toBeGreaterThan(send)
  })
})
