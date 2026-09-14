import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const buttonPath = join(__dirname, "..", "..", "webview-ui", "src", "components", "shared", "SandboxButton.tsx")
const iconPath = join(__dirname, "..", "..", "..", "kilo-ui", "src", "components", "icon.tsx")
const src = readFileSync(path, "utf8")
const responses = readFileSync(
  join(__dirname, "..", "..", "webview-ui", "src", "components", "chat", "prompt-sandbox-messages.ts"),
  "utf8",
)
const button = readFileSync(buttonPath, "utf8")
const icons = readFileSync(iconPath, "utf8")

describe("PromptInput connection guard", () => {
  it("rechecks the connection after resolving async attachments and before clearing the draft", () => {
    const attachments = src.indexOf("const gitFile = await git.resolveAttachment")
    const guard = src.indexOf("if (isDisabled()) {", attachments)
    const finish = src.indexOf("finishPending(pendingId)", guard)
    const send = src.indexOf("session.sendMessage(", guard)
    const clear = src.indexOf("drafts.delete(key)", send)

    expect(attachments).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(attachments)
    expect(finish).toBeGreaterThan(guard)
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
    expect(toggle).toContain('setSandboxRequests((current) => ({ ...current, [sessionID ?? ""]: requestID }))')
    expect(toggle).not.toContain("setSandboxTarget")
    expect(toggle).not.toContain('type: "updateConfig"')
  })

  it("captures edits made while sandbox session creation is pending", () => {
    const start = src.indexOf("const created = (message:")
    const end = src.indexOf("const unsubscribe", start)
    const created = src.slice(start, end)
    const save = created.indexOf(
      "if (source === draftKey()) saveDraft(source, text(), reviewComments(), imageAttach.images())",
    )
    const move = created.indexOf("movePromptDraft(")

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(save).toBeGreaterThan(-1)
    expect(move).toBeGreaterThan(save)
    expect(created).toContain(
      "{ text: drafts, comments: reviewDrafts, images: imageDrafts, scrolls: scrollDrafts, browsers: references }",
    )
    expect(created).toContain("saveDraft(source, text(), reviewComments(), imageAttach.images())")
  })

  it("restores each prompt draft's textarea and highlight scroll positions", () => {
    expect(src).toContain("scrollDrafts")
    expect(src).toContain("const scroll = scrollDrafts.get(key) ?? 0")
    expect(src).toContain("textareaRef.scrollTop = scroll")
    expect(src).toContain("if (highlightRef) highlightRef.scrollTop = scroll")
    expect(src).toContain("scrollDrafts.set(draftKey(), textareaRef.scrollTop)")
    expect(src).toContain(
      "images: imageAttach.images(),\n    browsers: browsers(),\n    scroll: textareaRef?.scrollTop",
    )
    expect(src).toContain("draft.text,")
    expect(src).toContain("draft.comments,")
    expect(src).toContain("draft.images,")
    expect(src).toContain("draft.scroll,")
    expect(src).toContain("draft.browsers")
  })

  it("tracks in-flight toggles per session while switching", () => {
    expect(src).toContain("const [sandboxRequests, setSandboxRequests] = createSignal<Record<string, string>>({})")
    expect(src).toContain('const sandboxRequest = (sessionID?: string) => sandboxRequests()[sessionID ?? ""]')
    expect(src).toContain("sandboxRequest(sandboxID()) !== undefined")
    expect(src).toContain("if (current[key] !== requestID) return current")
    expect(src).toContain("pending: sandboxRequest")
    expect(src).toContain("clear: clearSandboxRequest")
    expect(responses).toContain("input.clear(message.sessionID, message.requestID!)")
    expect(src).not.toContain("setSandboxTarget")
  })

  it("shows sandbox controls only when the global sandbox setting is enabled", () => {
    expect(src).toContain(
      'globalConfig().sandbox?.enabled === true &&\n    !session.currentSessionID()?.startsWith("cloud:")',
    )
    expect(src).toContain("features().sandboxControls &&")
    expect(src).toContain("<Show when={sandboxVisible()}>")
    expect(src).toContain("{ action: toggleSandbox, enabled: () => sandboxVisible() && !sandboxDisabled() }")
    expect(src).toContain('if (!sandboxVisible()) hidden.add("sandbox")')
    expect(src).toContain("onToggle={toggleSandbox}")
    expect(responses).toContain('case "sandboxStatus":')
    expect(responses).not.toContain("message.sessionID !== input.session() && !matching")
    expect(responses).toContain("const next = applySandboxStates(current, message)")
    expect(responses).toContain("if (next !== current) input.setStates(next)")
    expect(responses).toContain("message.requestID === input.pending(message.sessionID)")
    expect(responses).toContain("if (message.sessionID === input.session()) input.reset()")
    expect(responses).toContain("if (message.sessionID === input.session()) input.retry(message.sessionID)")
    expect(src).toContain("sandboxID() ? sandbox()?.enabled : sandboxDefault()?.enabled")
    expect(src).toContain('type: "requestSandboxDefault", agentManagerContext: ctx()')
    expect(src).toContain("<SandboxButtonBase")
    expect(src).toContain("enabled={sandboxEnabled()}")
    expect(src).toContain("available={sandboxReady() ? sandboxAvailable() : undefined}")
    expect(src).toContain("!sandboxReady()")
    expect(button).toContain("aria-pressed={props.enabled}")
    expect(button).toContain('class={`prompt-status-button ${props.enabled ? "prompt-status-button--active" : ""}`}')
    expect(src).toContain("if (sandboxRequest(undefined)) return")
    expect(responses).not.toContain("if (state === current) return true")
  })

  it("keeps the response subscription and retry timer in the prompt", () => {
    expect(src).toContain("const handleSandboxMessage = sandboxMessages({")
    expect(src).toContain("connected: server.isConnected")
    expect(src).toContain("session: sandboxID")
    expect(src).toContain("defaults: sandboxDefault")
    expect(src).toContain("setDefault: setSandboxDefault")
    expect(src).toContain("states: sandboxes")
    expect(src).toContain("setStates: setSandboxes")
    expect(src).toContain("retry: retrySandbox")
    expect(src).toContain("refresh: requestSandbox")
    expect(src).toContain(
      "reset: () => {\n      sandboxAttempts = 0\n      if (sandboxRetry) clearTimeout(sandboxRetry)\n      sandboxRetry = undefined",
    )
    expect(src).toContain(
      "const unsubscribe = vscode.onMessage((message) => {\n    if (handleSandboxMessage(message)) return",
    )
    expect(src).toContain("unsubscribe()")
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
    expect(src).toContain('const sandboxNetworkEnabled = () => config().sandbox?.network !== "allow"')
    expect(src).toContain("<SandboxTooltipContent enabled={sandboxEnabled()} network={sandboxNetworkEnabled()} />")
    expect(src).toContain('tooltipClass="prompt-sandbox-tooltip-content"')
    expect(button).toContain("<IconButton")
    expect(button).toContain('icon="lock"')
    expect(button).toContain('<Icon name="folder" size="small" />')
    expect(button).toContain('<Icon name="globe" size="small" />')
    expect(button).toContain("props.enabled && props.network")
    expect(button).not.toContain('class="prompt-sandbox-network"')
    expect(button).not.toContain('class="prompt-sandbox-icon"')
    expect(icons).toContain("globe: {")
  })
})
