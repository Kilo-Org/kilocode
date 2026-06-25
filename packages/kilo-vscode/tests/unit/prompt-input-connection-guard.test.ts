import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const src = readFileSync(path, "utf8")
const iconPath = join(__dirname, "..", "..", "..", "kilo-ui", "src", "components", "icon.tsx")
const icons = readFileSync(iconPath, "utf8")

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
    expect(toggle).toContain("!sandboxVisible()")
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

  it("requires the enabled experiment for visibility and uses effective runtime state for the button", () => {
    expect(src).toContain(
      'return features().sandboxControls && config().experimental?.sandbox === true && !id?.startsWith("cloud:")',
    )
    expect(src).toContain("<Show when={sandboxVisible()}>")
    expect(src).toContain("{ action: toggleSandbox, enabled: () => sandboxVisible() && !sandboxDisabled() }")
    expect(src).toContain('if (!sandboxVisible()) hidden.add("sandbox")')
    expect(src).toContain("onClick={toggleSandbox}")
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

  it("preserves the draft when the sandbox control is disabled", () => {
    const start = src.indexOf("if (matched?.action)")
    const guard = src.indexOf("if (matched.enabled && !matched.enabled()) return", start)
    const clear = src.indexOf('setText("")', start)

    expect(start).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(start)
    expect(clear).toBeGreaterThan(guard)
    expect(src).toContain("disabled={sandboxDisabled()}")
  })

  it("explains filesystem and network state without changing the lock icon", () => {
    expect(src).toContain(
      "const sandboxNetworkEnabled = () => config().experimental?.sandbox_restrict_network !== false",
    )
    expect(src).toContain('<Icon name="lock" size="small" />')
    expect(src).toContain("<SandboxTooltipContent enabled={sandboxEnabled()} network={sandboxNetworkEnabled()} />")
    expect(src).toContain('<Icon name="folder" size="small" />')
    expect(src).toContain('<Icon name="globe" size="small" />')
    expect(src).toContain("props.enabled && props.network")
    expect(src).not.toContain('class="prompt-sandbox-network"')
    expect(src).not.toContain('class="prompt-sandbox-icon"')
    expect(icons).toContain("globe: {")
  })
})
