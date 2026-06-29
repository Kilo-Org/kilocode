import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { ensureSandbox } from "../../src/agent-manager/sandbox-bootstrap"

type State = {
  directory: string
  enabled: boolean
  available: boolean
  reason?: string
  version: number
}

function setup(states: State[]) {
  const calls: string[] = []
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      calls.push(`${request.method} ${new URL(request.url).pathname}`)
      const state = states.shift()
      if (!state) return Response.json({ message: "Unexpected request" }, { status: 500 })
      return Response.json(state)
    },
    { preconnect: globalThis.fetch.preconnect },
  ) satisfies typeof globalThis.fetch

  return {
    calls,
    client: createKiloClient({ baseUrl: "http://localhost", fetch }),
  }
}

function state(enabled: boolean, available = true, directory = "/repo"): State {
  return { directory, enabled, available, version: 1 }
}

describe("ensureSandbox", () => {
  test("does not toggle when the effective state already matches", async () => {
    const ctx = setup([state(true)])

    const result = await ensureSandbox(ctx.client, "session-1", "/repo", true)

    expect(result.enabled).toBe(true)
    expect(ctx.calls).toEqual(["GET /session/session-1/sandbox"])
  })

  test("toggles and verifies the selected state", async () => {
    const ctx = setup([state(false), state(true)])

    const result = await ensureSandbox(ctx.client, "session-1", "/repo", true)

    expect(result.enabled).toBe(true)
    expect(ctx.calls).toEqual(["GET /session/session-1/sandbox", "POST /session/session-1/sandbox/toggle"])
  })

  test("rejects unavailable sandboxing when sandbox was requested", async () => {
    const unavailable = { ...state(false, false), reason: "Sandbox backend unavailable" }
    const ctx = setup([unavailable])

    expect(ensureSandbox(ctx.client, "session-1", "/repo", true)).rejects.toThrow("Sandbox backend unavailable")
    expect(ctx.calls).toEqual(["GET /session/session-1/sandbox"])
  })

  test("allows an effectively disabled sandbox when the backend is unavailable", async () => {
    const ctx = setup([state(false, false)])

    const result = await ensureSandbox(ctx.client, "session-1", "/repo", false)

    expect(result.enabled).toBe(false)
    expect(ctx.calls).toEqual(["GET /session/session-1/sandbox"])
  })

  test("rejects a toggle that does not reach the selected state", async () => {
    const ctx = setup([state(false), state(false)])

    expect(ensureSandbox(ctx.client, "session-1", "/repo", true)).rejects.toThrow(
      "Sandbox remained disabled after reconciliation",
    )
  })

  test("rejects status returned for a different directory without toggling", async () => {
    const ctx = setup([state(false, true, "/other")])

    expect(ensureSandbox(ctx.client, "session-1", "/repo", true)).rejects.toThrow(
      "Sandbox status resolved a different directory",
    )
    expect(ctx.calls).toEqual(["GET /session/session-1/sandbox"])
  })
})

describe("Agent Manager sandbox startup", () => {
  const provider = readFileSync(join(__dirname, "..", "..", "src", "agent-manager", "AgentManagerProvider.ts"), "utf8")
  const dialog = readFileSync(
    join(__dirname, "..", "..", "webview-ui", "agent-manager", "NewWorktreeDialog.tsx"),
    "utf8",
  )

  test("reconciles before exposing or prompting the session", () => {
    const start = provider.indexOf("private async onCreateMultiVersion")
    const end = provider.indexOf("\n  private ", start + 1)
    const body = provider.slice(start, end)
    const ensure = body.indexOf("await ensureSandbox")
    const discard = body.indexOf("await this.discardWorktree", ensure)
    const skip = body.indexOf("continue", discard)
    const register = body.indexOf("this.registerWorktreeSession", ensure)
    const ready = body.indexOf("this.notifyWorktreeReady", register)
    const created = body.indexOf("created.push", ready)
    const prompt = body.indexOf('type: "agentManager.sendInitialMessage"', created)

    expect(ensure).toBeGreaterThan(-1)
    expect(discard).toBeGreaterThan(ensure)
    expect(skip).toBeGreaterThan(discard)
    expect(register).toBeGreaterThan(skip)
    expect(ready).toBeGreaterThan(register)
    expect(created).toBeGreaterThan(ready)
    expect(prompt).toBeGreaterThan(created)
  })

  test("deletes the fresh branch when sandbox setup rolls back", () => {
    expect(provider).toContain("private async discardWorktree(id: string, dir: string, branch: string")
    expect(provider).toContain("removeWorktree(dir, branch)")
    expect(provider).toContain("wt.result.path, wt.result.branch, session.id")
  })

  test("uses the persisted sandbox default for UI and only sends explicit overrides", () => {
    expect(dialog).toContain("const sandboxVisible = () => features().sandboxControls")
    expect(dialog).toContain('vscode.postMessage({ type: "requestSandboxDefault", requestID: sandboxRequestID })')
    expect(dialog).toContain(
      'vscode.postMessage({ type: "setSandboxDefault", enabled: next, requestID: sandboxRequestID })',
    )
    expect(dialog).toContain("sandbox: sandboxVisible() ? sandboxOverride() : undefined")
    expect(dialog).toContain("<Show when={sandboxVisible()}>")
    expect(dialog).not.toContain("visible as isSandboxVisible")
  })

  test("places the sandbox toggle with prompt actions instead of model selectors", () => {
    const selectors = dialog.indexOf('<div class="prompt-input-hint-selectors">')
    const actions = dialog.indexOf('<div class="prompt-input-hint-actions">', selectors)
    const sandbox = dialog.indexOf("<SandboxButtonBase", actions)
    const speech = dialog.indexOf("<SpeechToTextButton", actions)

    expect(selectors).toBeGreaterThan(-1)
    expect(actions).toBeGreaterThan(selectors)
    expect(dialog.slice(selectors, actions)).not.toContain("<SandboxButtonBase")
    expect(sandbox).toBeGreaterThan(actions)
    expect(speech).toBeGreaterThan(sandbox)
  })
})
