import { afterEach, describe, expect, it } from "bun:test"
import { commands, languages, window, type ExtensionContext } from "vscode"
import { registerCodeActions } from "../src/services/code-actions/register-code-actions"
import { registerTerminalActions } from "../src/services/code-actions/register-terminal-actions"
import { chatFocus, createChatTarget } from "../src/services/code-actions/target"

type Command = (...args: unknown[]) => unknown

type Api = {
  commands: {
    registerCommand: (id: string, callback: Command) => { dispose(): void }
    executeCommand: (...args: unknown[]) => Promise<void>
  }
  window: {
    activeTextEditor?: unknown
    showInputBox: (options: unknown) => Promise<string | undefined>
  }
  languages: {
    getDiagnostics: (uri: unknown) => unknown[]
  }
}

const api = { commands, window, languages } as unknown as Api
const original = {
  register: api.commands.registerCommand,
  execute: api.commands.executeCommand,
  editor: api.window.activeTextEditor,
  input: api.window.showInputBox,
  diagnostics: api.languages.getDiagnostics,
}

function dataUrlText(uri: string) {
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8")
}

function setup(options: { agentActive?: boolean; agentReady?: boolean } = {}) {
  const handlers = new Map<string, Command>()
  const executed: string[][] = []
  const posts: unknown[] = []
  const agentPosts: unknown[] = []
  const waits: string[] = []
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as unknown as ExtensionContext

  api.commands.registerCommand = (id, callback) => {
    handlers.set(id, callback)
    return { dispose: () => undefined }
  }
  api.commands.executeCommand = async (...args: unknown[]) => {
    executed.push(args.map(String))
  }
  api.languages.getDiagnostics = () => []

  const agent = {
    isActive: () => options.agentActive ?? false,
    waitForReady: async () => {
      waits.push("agent")
      return options.agentReady ?? true
    },
    postMessage: (message: unknown) => agentPosts.push(message),
    focusPanel: () => waits.push("reveal"),
  }
  const view = {
    post: (message: unknown) => {
      posts.push(message)
      return Promise.resolve(true)
    },
  }

  const target = createChatTarget({ view, agentManager: agent })
  registerCodeActions(context, target)
  registerTerminalActions(context, target)

  return { handlers, executed, posts, agentPosts, waits }
}

function selectCode() {
  api.window.activeTextEditor = {
    selection: { isEmpty: false, start: { line: 2 }, end: { line: 4 } },
    document: {
      uri: { scheme: "file", fsPath: "/repo/src/file.ts" },
      getText: () => "const value = 1",
    },
  }
}

afterEach(() => {
  chatFocus.closed("sidebar")
  chatFocus.closed("agentManager")
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.activeTextEditor = original.editor
  api.window.showInputBox = original.input
  api.languages.getDiagnostics = original.diagnostics
})

describe("registerCodeActions", () => {
  it("registers the v2 command ids", () => {
    const state = setup()

    expect([...state.handlers.keys()]).toEqual([
      "kilo-code.v2.addToContext",
      "kilo-code.v2.explainCode",
      "kilo-code.v2.fixCode",
      "kilo-code.v2.improveCode",
      "kilo-code.v2.focusChatInput",
      "kilo-code.v2.generateTerminalCommand",
      "kilo-code.v2.terminalAddToContext",
      "kilo-code.v2.terminalFixCommand",
      "kilo-code.v2.terminalExplainCommand",
    ])
  })

  it("returns early without an editor selection", async () => {
    const state = setup()
    api.window.activeTextEditor = undefined

    await state.handlers.get("kilo-code.v2.addToContext")?.()
    await state.handlers.get("kilo-code.v2.explainCode")?.()

    expect(state.posts).toEqual([])
    expect(state.agentPosts).toEqual([])
    expect(state.executed).toEqual([])
  })

  it("adds the selection to the sidebar and focuses the chat", async () => {
    const state = setup()
    selectCode()

    await state.handlers.get("kilo-code.v2.addToContext")?.()

    expect(state.executed).toEqual([["kilo-code.v2.chat.focus"]])
    expect(state.posts).toHaveLength(1)
    const post = state.posts[0] as { type: string; items: Array<Record<string, unknown>> }
    expect(post.type).toBe("appendContext")
    expect(post.items).toHaveLength(1)
    expect(post.items[0]).toMatchObject({
      kind: "selection",
      name: "file.ts:3-5",
      description: "src/file.ts, lines 3-5",
      path: "src/file.ts",
      line: 3,
    })
    expect(dataUrlText(String(post.items[0]?.uri))).toBe("const value = 1")
  })

  it("adds the selection to an active Agent Manager without revealing the sidebar", async () => {
    const state = setup({ agentActive: true })
    selectCode()

    await state.handlers.get("kilo-code.v2.addToContext")?.()

    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["reveal", "agent"])
    expect(state.posts).toEqual([])
    expect(state.agentPosts).toHaveLength(1)
    expect((state.agentPosts[0] as { type: string }).type).toBe("appendContext")
  })

  it("adds the selection to the Agent Manager focused last, while the editor is active", async () => {
    const state = setup({ agentActive: false })
    chatFocus.gained("agentManager")
    selectCode()

    await state.handlers.get("kilo-code.v2.addToContext")?.()
    await state.handlers.get("kilo-code.v2.focusChatInput")?.()

    expect(state.posts).toEqual([])
    expect(state.agentPosts.map((post) => (post as { type: string }).type)).toEqual(["appendContext", "action"])
  })

  it("adds the selection to the sidebar focused last, even while the Agent Manager is active", async () => {
    const state = setup({ agentActive: true })
    chatFocus.gained("sidebar")
    selectCode()

    await state.handlers.get("kilo-code.v2.addToContext")?.()

    expect(state.agentPosts).toEqual([])
    expect((state.posts[0] as { type: string }).type).toBe("appendContext")
  })

  it("forgets a closed Agent Manager", async () => {
    const state = setup({ agentActive: false })
    chatFocus.gained("agentManager")
    chatFocus.closed("agentManager")
    selectCode()

    await state.handlers.get("kilo-code.v2.addToContext")?.()

    expect(state.agentPosts).toEqual([])
    expect((state.posts[0] as { type: string }).type).toBe("appendContext")
  })

  it("skips the post when the Agent Manager readiness wait is cancelled", async () => {
    const state = setup({ agentActive: true, agentReady: false })
    selectCode()

    await state.handlers.get("kilo-code.v2.addToContext")?.()

    expect(state.waits).toEqual(["reveal", "agent"])
    expect(state.agentPosts).toEqual([])
    expect(state.posts).toEqual([])
  })

  it("sends the explain prompt with the selection attachment", async () => {
    const state = setup()
    selectCode()

    await state.handlers.get("kilo-code.v2.explainCode")?.()

    expect(state.executed).toEqual([["kilo-code.v2.chat.focus"]])
    const post = state.posts[0] as { type: string; text: string; items: Array<Record<string, unknown>> }
    expect(post.type).toBe("startPrompt")
    expect(post.text).toContain("Explain the attached selection from src/file.ts:3-5")
    expect(post.text).not.toContain("const value = 1")
    expect(post.items).toHaveLength(1)
    expect(dataUrlText(String(post.items[0]?.uri))).toBe("const value = 1")
  })

  it("sends the fix prompt with the diagnostics text", async () => {
    const state = setup()
    selectCode()
    api.languages.getDiagnostics = () => [
      {
        source: "ts",
        message: "Cannot find name 'value'",
        code: 2304,
        range: { intersection: () => ({}) },
      },
    ]

    await state.handlers.get("kilo-code.v2.fixCode")?.()

    const post = state.posts[0] as { text: string }
    expect(post.text).toContain("Fix any issues in the attached selection from src/file.ts:3-5")
    expect(post.text).toContain("Current problems detected:")
    expect(post.text).toContain("[ts] Cannot find name 'value' (2304)")
  })

  it("routes the improve prompt to the Agent Manager when it is active", async () => {
    const state = setup({ agentActive: true })
    selectCode()

    await state.handlers.get("kilo-code.v2.improveCode")?.()

    expect(state.waits).toEqual(["agent"])
    expect(state.executed).toEqual([])
    expect((state.agentPosts[0] as { type: string }).type).toBe("startPrompt")
  })

  it("focuses the Agent Manager input", async () => {
    const state = setup({ agentActive: true })

    await state.handlers.get("kilo-code.v2.focusChatInput")?.()

    expect(state.executed).toEqual([])
    expect(state.agentPosts).toEqual([{ type: "action", action: "focusInput" }])
  })

  it("focuses the sidebar prompt", async () => {
    const state = setup()

    await state.handlers.get("kilo-code.v2.focusChatInput")?.()

    expect(state.executed).toEqual([["kilo-code.v2.chat.focus"]])
    expect(state.posts).toEqual([{ type: "command", name: "focusPrompt" }])
  })

  it("sends the typed terminal command request", async () => {
    const state = setup()
    api.window.showInputBox = async () => "find . -name '*.ts'"

    await state.handlers.get("kilo-code.v2.generateTerminalCommand")?.()

    expect(state.posts).toEqual([{ type: "startPrompt", text: "Generate a terminal command: find . -name '*.ts'" }])
  })

  it("does nothing when the terminal command input is cancelled", async () => {
    const state = setup()
    api.window.showInputBox = async () => undefined

    await state.handlers.get("kilo-code.v2.generateTerminalCommand")?.()

    expect(state.posts).toEqual([])
    expect(state.executed).toEqual([])
  })

  it("attaches terminal selection text", async () => {
    const state = setup()

    await state.handlers.get("kilo-code.v2.terminalAddToContext")?.({ selection: "git status" })

    const post = state.posts[0] as { type: string; items: Array<Record<string, unknown>> }
    expect(post.type).toBe("appendContext")
    expect(post.items[0]).toMatchObject({ kind: "terminal", name: "Terminal output" })
    expect(dataUrlText(String(post.items[0]?.uri))).toBe("git status")
  })

  it("sends terminal fix and explain prompts", async () => {
    const state = setup()

    await state.handlers.get("kilo-code.v2.terminalFixCommand")?.({ selection: "git statsu" })
    await state.handlers.get("kilo-code.v2.terminalExplainCommand")?.({ selection: "git status" })

    expect((state.posts[0] as { text: string }).text).toContain("Fix this terminal command:\n```\ngit statsu\n```")
    expect((state.posts[1] as { text: string }).text).toContain(
      "Explain this terminal command:\n```\ngit status\n```",
    )
  })
})
