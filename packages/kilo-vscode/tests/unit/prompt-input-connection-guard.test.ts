import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const buttonPath = join(__dirname, "..", "..", "webview-ui", "src", "components", "shared", "SandboxButton.tsx")
const iconPath = join(__dirname, "..", "..", "..", "kilo-ui", "src", "components", "icon.tsx")
const src = readFileSync(path, "utf8")
const button = readFileSync(buttonPath, "utf8")
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
  it("updates the default for drafts and toggles only existing sessions", () => {
    const start = src.indexOf("const toggleSandbox = () =>")
    const end = src.indexOf("let enhanceCounter", start)
    const toggle = src.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(toggle).toContain("const sessionID = sandboxID()")
    expect(toggle).toContain("!sandboxVisible()")
    expect(toggle).toContain("if (!sessionID) saveDraft(draftKey(), text(), reviewComments(), imageAttach.images())")
    expect(toggle).toContain('type: "toggleSandbox"')
    expect(toggle).toContain('type: "setSandboxDefault"')
    expect(toggle).toContain("enabled: !sandboxDefault()!.desired")
    expect(toggle).toContain("agentManagerContext: ctx()")
    expect(toggle).toContain("sessionID,")
    expect(toggle).toContain("requestID,")
    expect(toggle).not.toContain("draftID:")
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

  it("keeps persisted sandbox state visible independently of the configured default", () => {
    expect(src).toContain(
      'const sandboxVisible = () => features().sandboxControls && !session.currentSessionID()?.startsWith("cloud:")',
    )
    expect(src).not.toContain("config().experimental?.sandbox === true")
    expect(src).toContain("<Show when={sandboxVisible()}>")
    expect(src).toContain("{ action: toggleSandbox, enabled: () => sandboxVisible() && !sandboxDisabled() }")
    expect(src).toContain('if (!sandboxVisible()) hidden.add("sandbox")')
    expect(src).toContain("onToggle={toggleSandbox}")
    expect(src).toContain('message.type === "sandboxStatus"')
    expect(src).toContain("message.sessionID !== sandboxID() && !matching")
    expect(src).toContain("setSandboxState(state)")
    expect(src).toContain("message.requestID === sandboxRequest()")
    expect(src).toContain("const target = untrack(sandboxTarget)")
    expect(src).toContain("if (target !== undefined && target !== sessionID) clearSandboxRequest()")
    expect(src).toContain("sandboxID() ? sandbox()?.enabled : sandboxDefault()?.enabled")
    expect(src).toContain('type: "requestSandboxDefault", agentManagerContext: ctx()')
    expect(src).toContain("<SandboxButtonBase")
    expect(src).toContain("enabled={sandboxEnabled()}")
    expect(src).toContain("available={sandboxReady() ? sandboxAvailable() : undefined}")
    expect(src).toContain("!sandboxReady()")
    expect(button).toContain("aria-pressed={props.enabled}")
    expect(button).toContain('class={`prompt-status-button ${props.enabled ? "prompt-status-button--active" : ""}`}')
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
    expect(src).toContain("<SandboxTooltipContent enabled={sandboxEnabled()} network={sandboxNetworkEnabled()} />")
    expect(src).toContain('tooltipClass="prompt-sandbox-tooltip-content"')
    expect(button).toContain('<Icon name="lock" size="small" />')
    expect(button).toContain('<Icon name="folder" size="small" />')
    expect(button).toContain('<Icon name="globe" size="small" />')
    expect(button).toContain("props.enabled && props.network")
    expect(button).not.toContain('class="prompt-sandbox-network"')
    expect(button).not.toContain('class="prompt-sandbox-icon"')
    expect(icons).toContain("globe: {")
  })
})
