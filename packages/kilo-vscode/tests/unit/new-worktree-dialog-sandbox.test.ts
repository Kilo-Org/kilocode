import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const path = join(__dirname, "..", "..", "webview-ui", "agent-manager", "NewWorktreeDialog.tsx")
const providerPath = join(__dirname, "..", "..", "src", "KiloProvider.ts")
const src = readFileSync(path, "utf8")
const provider = readFileSync(providerPath, "utf8")

describe("NewWorktreeDialog sandbox toggle", () => {
  it("uses the persisted default and only sends explicit modal overrides", () => {
    expect(src).toContain('vscode.postMessage({ type: "requestSandboxDefault", requestID: sandboxRequestID })')
    expect(src).toContain('if (message.type !== "sandboxDefaultStatus") return')
    expect(src).toContain("if (message.requestID !== sandboxRequestID) return")
    expect(src).toContain("setSandbox(message.enabled)")
    expect(src).toContain("setSandboxOverride(next === sandboxDefault() ? undefined : next)")
    expect(src).toContain(
      'vscode.postMessage({ type: "setSandboxDefault", enabled: next, requestID: sandboxRequestID })',
    )
    expect(src).toContain("sandbox: sandboxVisible() ? sandboxOverride() : undefined")
    expect(src).toContain("const sandboxVisible = () => features().sandboxControls")
    expect(provider).toContain("await this.fetchAndSendSandboxDefault(message.contextDirectory, message.requestID)")
    expect(src).not.toContain("createSignal(config().sandbox?.enabled === true)")
    expect(src).not.toContain("visible as isSandboxVisible")
  })
})
