import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const src = readFileSync(path, "utf8")

describe("PromptInput connection guard", () => {
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

describe("PromptInput sandbox toggle", () => {
  it("toggles or creates the runtime session instead of writing config", () => {
    const start = src.indexOf("const toggleSandbox = () =>")
    const end = src.indexOf("let enhanceCounter", start)
    const toggle = src.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(toggle).toContain("const sessionID = sandboxID()")
    expect(toggle).toContain("if (!sessionID) saveDraft(draftKey(), text(), reviewComments(), imageAttach.images())")
    expect(toggle).toContain('type: "toggleSandbox"')
    expect(toggle).toContain("sessionID,")
    expect(toggle).toContain("draftID: props.pendingSessionID ?? session.draftSessionID()")
    expect(toggle).toContain("requestID,")
    expect(toggle).toContain("setSandboxTarget(sessionID ?? null)")
    expect(toggle).not.toContain('type: "updateConfig"')
  })

  it("captures edits made while sandbox session creation is pending", () => {
    const start = src.indexOf('if (message.type === "sessionCreated")')
    const end = src.indexOf('if (message.type === "action"', start)
    const created = src.slice(start, end)
    const save = created.indexOf(
      "if (source === draftKey()) saveDraft(source, text(), reviewComments(), imageAttach.images())",
    )
    const move = created.indexOf("movePromptDraft(")

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(save).toBeGreaterThan(-1)
    expect(move).toBeGreaterThan(save)
  })

  it("uses the internal flag for visibility and effective runtime state for the button", () => {
    expect(src).toContain("features().sandboxControls")
    expect(src).toContain("<Show when={sandboxVisible()}>")
    expect(src).toContain('message.type === "sandboxStatus"')
    expect(src).toContain("message.sessionID !== sandboxID() && !matching")
    expect(src).toContain("setSandboxState(state)")
    expect(src).toContain("message.requestID === sandboxRequest()")
    expect(src).toContain("const target = untrack(sandboxTarget)")
    expect(src).toContain("if (target && target !== sessionID) clearSandboxRequest()")
    expect(src).toContain("sandbox()?.enabled ?? (!sandboxID() && config().experimental?.sandbox === true)")
    expect(src).toContain("aria-pressed={sandboxEnabled()}")
    expect(src).toContain("!sandboxReady()")
    expect(src).toContain("if (sandboxRequest() && target === null) return")
    expect(src).not.toContain("if (state === current) return true")
  })
})
