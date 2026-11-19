import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerCodeActions } from "../../src/services/code-actions/register-code-actions"

type Command = (...args: unknown[]) => unknown

type Api = typeof vscode & {
  commands: {
    registerCommand: (command: string, callback: Command) => { dispose(): void }
    executeCommand: (...args: unknown[]) => Promise<void>
  }
  languages: {
    getDiagnostics: () => Array<{ range: { intersection: () => unknown } }>
  }
  window: typeof vscode.window & { activeTextEditor?: unknown }
}

const api = vscode as Api
const documents = api.workspace as unknown as { textDocuments: unknown[] }
const original = {
  register: api.commands.registerCommand,
  execute: api.commands.executeCommand,
  editor: api.window.activeTextEditor,
  diagnostics: api.languages.getDiagnostics,
  documents: documents.textDocuments,
}

function setDocuments(docs: unknown[]) {
  documents.textDocuments = docs
}

function setup(active = false, agentReady = true, last?: "sidebar" | "agent" | "tab", tabbed = false) {
  const commands = new Map<string, Command>()
  const executed: unknown[][] = []
  const events: string[] = []
  const posts: unknown[] = []
  const waits: string[] = []
  const recipients: string[] = []
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
  const provider = {
    postMessage: (msg: unknown) => {
      recipients.push("sidebar")
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("provider")
    },
  }
  const agent = {
    isActive: () => active,
    postMessage: (msg: unknown) => {
      recipients.push("agent")
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("agent")
      return agentReady
    },
  }
  const tab = {
    postMessage: (msg: unknown) => {
      recipients.push("tab")
      posts.push(msg)
    },
    waitForReady: async () => {
      waits.push("tab")
    },
  }
  const focused = { current: last }

  api.commands.registerCommand = (command, callback) => {
    commands.set(command, callback)
    return { dispose: () => undefined }
  }
  api.commands.executeCommand = async (...args) => {
    events.push("focus")
    executed.push(args)
  }
  api.languages.getDiagnostics = () => []
  api.window.activeTextEditor = {
    selection: {
      isEmpty: false,
      start: { line: 2 },
      end: { line: 4 },
    },
    document: {
      uri: vscode.Uri.file("/repo/src/file.ts"),
      getText: () => "const value = 1",
    },
  }

  const views = { sidebar: provider, agent, tab }
  registerCodeActions(context, provider as never, agent as never, tabbed ? () => tab as never : undefined, () =>
    focused.current ? (views[focused.current] as never) : undefined,
  )

  return { commands, events, executed, posts, waits, recipients, focused }
}

afterEach(() => {
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.activeTextEditor = original.editor
  api.languages.getDiagnostics = original.diagnostics
  documents.textDocuments = original.documents
})

function emptySelection() {
  const seen: unknown[] = []
  api.window.activeTextEditor = {
    selection: { isEmpty: true, start: { line: 0 }, end: { line: 0 } },
    document: {
      uri: vscode.Uri.file("/repo/src/file.ts"),
      getText: (selection: unknown) => {
        seen.push(selection)
        return "const value = 1"
      },
    },
  }
  api.languages.getDiagnostics = () => []
  return seen
}

function expectContextPost(post: unknown) {
  const value = post as { type: string; context: Record<string, unknown> }
  expect(value.type).toBe("appendChatContext")
  expect(value.context).toMatchObject({
    filePath: "src/file.ts",
    startLine: 3,
    endLine: 5,
    text: "const value = 1",
  })
  expect(typeof value.context.id).toBe("string")
  expect(value.context.id).not.toHaveLength(0)
}

describe("registerCodeActions", () => {
  it("keeps targeting Agent Manager after the code editor takes focus", async () => {
    const state = setup(false, true, "agent")

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.recipients).toEqual(["agent"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["agent"])
    expectContextPost(state.posts.at(0))
  })

  it.each(["sidebar", "tab"] as const)("prefers the last focused %s over the active panel", async (last) => {
    const state = setup(true, true, last)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.recipients).toEqual([last])
    expect(state.executed).toEqual(last === "sidebar" ? [["kilo-code.SidebarProvider.focus"]] : [])
    expectContextPost(state.posts.at(0))
  })

  it("uses the latest focused chat and falls back after it closes", async () => {
    const state = setup(false, true, "tab")
    state.focused.current = "agent"
    await state.commands.get("kilo-code.new.addToContext")?.()
    state.focused.current = undefined
    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.recipients).toEqual(["agent", "sidebar"])
  })

  it("does not reroute when the remembered Agent Manager closes while waiting", async () => {
    const state = setup(false, false, "agent")

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.waits).toEqual(["agent"])
    expect(state.recipients).toEqual([])
    expect(state.executed).toEqual([])
  })

  it("keeps focus-only commands on their existing route", async () => {
    const state = setup(false, true, "agent")

    await state.commands.get("kilo-code.new.focusChatInput")?.()
    await state.commands.get("kilo-code.new.toggleChatSearch")?.()

    expect(state.recipients).toEqual(["sidebar", "sidebar"])
    expect(state.waits).toEqual(["provider", "provider"])
  })

  it("reveals the sidebar before adding selected code to context", async () => {
    const state = setup()

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.executed).toEqual([["kilo-code.SidebarProvider.focus"]])
    expect(state.waits).toEqual(["provider"])
    expect(state.posts).toHaveLength(1)
    expectContextPost(state.posts[0])
  })

  it("adds selected code to the active Agent Manager without revealing the sidebar", async () => {
    const state = setup(true)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["agent"])
    expect(state.posts).toHaveLength(1)
    expectContextPost(state.posts[0])
  })

  it("does not post to the Agent Manager when its readiness wait is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("kilo-code.new.addToContext")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })

  it("toggles chat search on the active Agent Manager once it is ready", async () => {
    const state = setup(true)

    await state.commands.get("kilo-code.new.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.posts).toEqual([{ type: "action", action: "focusSearch" }])
  })

  it("shows open tabs in the sidebar even when Agent Manager is active", async () => {
    const state = setup(true)

    await state.commands.get("kilo-code.new.showOpenTabs")?.()

    expect(state.recipients).toEqual(["sidebar"])
    expect(state.executed).toEqual([["kilo-code.SidebarProvider.focus"]])
    expect(state.posts).toEqual([{ type: "action", action: "showOpenTabs" }])
  })

  it("shows open tabs in the active Kilo editor tab without revealing the sidebar", async () => {
    const state = setup(false, true, undefined, true)

    await state.commands.get("kilo-code.new.showOpenTabs")?.()

    expect(state.recipients).toEqual(["tab"])
    expect(state.waits).toEqual(["tab"])
    expect(state.executed).toEqual([])
    expect(state.posts).toEqual([{ type: "action", action: "showOpenTabs" }])
  })

  it("prefers the last focused sidebar over an active Kilo editor tab", async () => {
    const state = setup(false, true, "sidebar", true)

    await state.commands.get("kilo-code.new.showOpenTabs")?.()

    expect(state.recipients).toEqual(["sidebar"])
    expect(state.executed).toEqual([["kilo-code.SidebarProvider.focus"]])
    expect(state.posts).toEqual([{ type: "action", action: "showOpenTabs" }])
  })

  it("redirects open tabs to the sidebar when Agent Manager was last focused", async () => {
    const state = setup(false, true, "agent", true)

    await state.commands.get("kilo-code.new.showOpenTabs")?.()

    expect(state.recipients).toEqual(["sidebar"])
    expect(state.waits).toEqual(["provider"])
    expect(state.posts).toEqual([{ type: "action", action: "showOpenTabs" }])
  })

  it("does not toggle chat search when Agent Manager readiness is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("kilo-code.new.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })

  describe("fixCode", () => {
    it("uses the quick fix range when the editor selection is empty", async () => {
      const state = setup()
      const seen = emptySelection()
      const range = new vscode.Range(new vscode.Position(2, 0), new vscode.Position(4, 0))
      const diagnostics = [{ source: "eslint", message: "Missing semicolon" }] as never

      await state.commands.get("kilo-code.new.fixCode")?.(range, diagnostics)

      expect(seen).toEqual([range])
      const post = state.posts.at(0) as { type: string; text: string }
      expect(post.type).toBe("triggerTask")
      expect(post.text).toContain("src/file.ts:3-5")
      expect(post.text).toContain("[eslint] Missing semicolon")
    })

    it("uses the marshalled quick fix range that lost its prototype over the extension host RPC", async () => {
      const state = setup()
      const seen = emptySelection()
      const marshalled = { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } }

      await state.commands.get("kilo-code.new.fixCode")?.(marshalled)

      expect(seen).toEqual([marshalled])
      const post = state.posts.at(0) as { type: string; text: string }
      expect(post.type).toBe("triggerTask")
      expect(post.text).toContain("src/file.ts:3-5")
    })

    it("does nothing when the marshalled quick fix range is empty", async () => {
      const state = setup()
      emptySelection()
      const marshalled = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

      await state.commands.get("kilo-code.new.fixCode")?.(marshalled)

      expect(state.posts).toEqual([])
    })

    it("passes the code action diagnostics through the prompt", async () => {
      const state = setup()
      emptySelection()
      const range = new vscode.Range(new vscode.Position(2, 0), new vscode.Position(4, 0))
      api.languages.getDiagnostics = () => [{ range: { intersection: () => ({}) } }]
      const given = [{ message: "Type error" }] as never

      await state.commands.get("kilo-code.new.fixCode")?.(range, given)

      expect((state.posts.at(0) as { text: string }).text).toContain("[Error] Type error")
    })

    it("falls back to the editor selection and live diagnostics without arguments", async () => {
      const state = setup()
      api.languages.getDiagnostics = () => [{ range: { intersection: () => ({}) } }]

      await state.commands.get("kilo-code.new.fixCode")?.()

      expect((state.posts.at(0) as { text: string }).text).toContain("src/file.ts:3-5")
    })

    it("does nothing when the selection is empty and no range is passed", async () => {
      const state = setup()
      emptySelection()

      await state.commands.get("kilo-code.new.fixCode")?.()

      expect(state.posts).toEqual([])
    })
  })

  describe("lightbulb actions", () => {
    const marshalled = { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } }

    it.each(["kilo-code.new.explainCode", "kilo-code.new.improveCode"] as const)(
      "%s uses the code action range when the editor selection is empty",
      async (command) => {
        const state = setup()
        const seen = emptySelection()

        await state.commands.get(command)?.(marshalled)

        expect(seen).toEqual([marshalled])
        const post = state.posts.at(0) as { type: string; text: string }
        expect(post.type).toBe("triggerTask")
        expect(post.text).toContain("src/file.ts:3-5")
      },
    )

    it("kilo-code.new.addToContext uses the code action range when the editor selection is empty", async () => {
      const state = setup()
      emptySelection()

      await state.commands.get("kilo-code.new.addToContext")?.(marshalled)

      expect(state.posts).toHaveLength(1)
      expectContextPost(state.posts.at(0))
    })

    it("does nothing when the marshalled code action range is empty", async () => {
      const state = setup()
      emptySelection()

      await state.commands.get("kilo-code.new.explainCode")?.({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      })

      expect(state.posts).toEqual([])
    })
  })

  describe("target document", () => {
    const marshalled = { start: { line: 2, character: 0 }, end: { line: 4, character: 0 } }

    it("reads from the code action document when the active editor shows a different file", async () => {
      const state = setup()
      const seen: unknown[] = []
      setDocuments([
        {
          uri: vscode.Uri.file("/repo/src/other.ts"),
          getText: (selection: unknown) => {
            seen.push(selection)
            return "let other = 1"
          },
        },
      ])

      await state.commands.get("kilo-code.new.fixCode")?.(marshalled, undefined, "file:///repo/src/other.ts")

      expect(seen).toEqual([marshalled])
      const post = state.posts.at(0) as { type: string; text: string }
      expect(post.text).toContain("src/other.ts:3-5")
      expect(post.text).toContain("let other = 1")
      expect(post.text).not.toContain("const value = 1")
    })

    it("does nothing when the code action document is no longer open", async () => {
      const state = setup()

      await state.commands.get("kilo-code.new.explainCode")?.(marshalled, "file:///repo/src/gone.ts")

      expect(state.posts).toEqual([])
    })

    it("uses the editor selection when the uri matches the active editor", async () => {
      const state = setup()

      await state.commands.get("kilo-code.new.addToContext")?.(undefined, "file:///repo/src/file.ts")

      expect(state.posts).toHaveLength(1)
      expectContextPost(state.posts.at(0))
    })
  })
})
