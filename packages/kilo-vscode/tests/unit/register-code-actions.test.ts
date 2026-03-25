// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
import { describe, expect, it } from "bun:test"
import { registerCodeActions } from "../../src/services/code-actions/register-code-actions"
import { mockVscode } from "../setup/vscode-mock"

type Handler = (...args: unknown[]) => unknown
type MockVscode = typeof mockVscode

interface SetupOptions {
  provider?: {
    waitForReady?: () => void | Promise<void>
    postMessage?: (message: unknown) => void
  }
  agentManager?: {
    isActive?: () => boolean
    postMessage?: (message: unknown) => void
  }
}

function setup(options: SetupOptions = {}) {
  const register = mockVscode.commands.registerCommand
  const execute = mockVscode.commands.executeCommand
  const active = mockVscode.window.activeTextEditor
  const relative = mockVscode.workspace.asRelativePath
  const diagnostics = mockVscode.languages.getDiagnostics

  const handlers = new Map<string, Handler>()
  const calls: string[] = []
  const posted: unknown[] = []

  mockVscode.commands.registerCommand = ((name: string, cb: Handler) => {
    handlers.set(name, cb)
    return { dispose() {} }
  }) as MockVscode["commands"]["registerCommand"]

  mockVscode.commands.executeCommand = ((name: string) => {
    calls.push(`exec:${name}`)
  }) as MockVscode["commands"]["executeCommand"]

  mockVscode.workspace.asRelativePath = ((value: { fsPath?: string; path?: string } | string) => {
    if (typeof value === "string") return value
    return value.fsPath ?? value.path ?? "unknown"
  }) as MockVscode["workspace"]["asRelativePath"]

  mockVscode.languages.getDiagnostics = () => [
    {
      range: { intersection: () => ({}) },
      source: "ts",
      message: "Type error",
      code: 2322,
    },
  ]

  mockVscode.window.activeTextEditor = {
    selection: {
      isEmpty: false,
      start: { line: 4 },
      end: { line: 6 },
    },
    document: {
      uri: { fsPath: "src/foo.ts" },
      getText: () => "const x = 1",
    },
  } as MockVscode["window"]["activeTextEditor"]

  const defaultProvider = {
    waitForReady: async () => {
      calls.push("wait")
    },
    postMessage: (message: unknown) => {
      calls.push("post")
      posted.push(message)
    },
  }

  const provider = options.provider ?? defaultProvider
  const context = { subscriptions: [] } as unknown as { subscriptions: unknown[] }
  registerCodeActions(context, provider as never, options.agentManager as never)

  return {
    handlers,
    calls,
    posted,
    restore() {
      mockVscode.commands.registerCommand = register
      mockVscode.commands.executeCommand = execute
      mockVscode.window.activeTextEditor = active
      mockVscode.workspace.asRelativePath = relative
      mockVscode.languages.getDiagnostics = diagnostics
    },
  }
}

describe("registerCodeActions", () => {
  it("focuses the sidebar and waits before posting fix tasks", async () => {
    const harness = setup()
    try {
      const cmd = harness.handlers.get("kilo-code.new.fixCode")
      expect(cmd).toBeDefined()

      await cmd?.()

      expect(harness.calls).toEqual(["exec:kilo-code.SidebarProvider.focus", "wait", "post"])
      expect(harness.posted).toHaveLength(1)

      const [message] = harness.posted as Array<{ type: string; text: string }>
      expect(message?.type).toBe("triggerTask")
      expect(message?.text).toContain("Fix any issues in the following code")
      expect(message?.text).toContain("[ts] Type error (2322)")
    } finally {
      harness.restore()
    }
  })

  it("does not focus the sidebar when no editor context is available", async () => {
    const harness = setup()
    try {
      mockVscode.window.activeTextEditor = undefined

      const cmd = harness.handlers.get("kilo-code.new.fixCode")
      await cmd?.()

      expect(harness.calls).toEqual([])
      expect(harness.posted).toEqual([])
    } finally {
      harness.restore()
    }
  })

  it("keeps fix tasks on the sidebar even when Agent Manager is active", async () => {
    const harness = setup({
      provider: {
        waitForReady: async () => {
          harness.calls.push("wait:sidebar")
        },
        postMessage: (message: unknown) => {
          harness.calls.push("post:sidebar")
          harness.posted.push(message)
        },
      },
      agentManager: {
        isActive: () => true,
        postMessage: () => {
          throw new Error("fixCode should not route through Agent Manager")
        },
      },
    })
    try {
      const cmd = harness.handlers.get("kilo-code.new.fixCode")
      await cmd?.()

      expect(harness.calls).toContain("exec:kilo-code.SidebarProvider.focus")
      expect(harness.calls).toContain("wait:sidebar")
      expect(harness.calls).toContain("post:sidebar")
    } finally {
      harness.restore()
    }
  })
})