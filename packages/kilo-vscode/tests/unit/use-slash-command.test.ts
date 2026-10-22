import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useSlashCommand, type SlashCommandEntry } from "../../webview-ui/src/hooks/useSlashCommand"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

function setup(
  sandbox: () => void,
  options: {
    enabled?: () => boolean
    exclude?: () => Set<string>
    include?: Set<string>
    extra?: SlashCommandEntry[]
  } = {},
) {
  const sent: WebviewMessage[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const root = createRoot((dispose) => ({
    dispose,
    slash: useSlashCommand(
      {
        postMessage: (message) => sent.push(message),
        onMessage: (handler) => {
          handlers.add(handler)
          return () => handlers.delete(handler)
        },
      },
      options.exclude,
      options.include,
      undefined,
      options.extra,
    ),
  }))
  const fire = (message: ExtensionMessage) => {
    for (const handler of handlers) handler(message)
  }
  return { ...root, fire, sent }
}

// Issue #14096: skills were listed as indistinguishable "Commands" rows.
describe("skill entries in the slash menu", () => {
  const loaded = (ctx: ReturnType<typeof setup>) =>
    ctx.fire({
      type: "commandsLoaded",
      commands: [
        { name: "foo", description: "custom command", source: "command", hints: [] },
        { name: "foo", description: "skill with the same name", source: "skill", hints: [] },
        { name: "grill", description: "a plain skill", source: "skill", hints: [] },
        { name: "grill", description: "duplicate skill row", source: "skill", hints: [] },
        { name: "notes", description: "mcp prompt", source: "mcp", hints: [] },
      ],
    })

  it("orders skills after commands so the dropdown can render a Skills group", () => {
    const ctx = setup(() => {})
    loaded(ctx)
    ctx.slash.onInput("/", 1)
    const server = ctx.slash.results().filter((cmd) => !cmd.action)
    const sources = server.map((cmd) => cmd.source ?? "command")
    const first = sources.indexOf("skill")
    expect(first).toBeGreaterThan(0)
    expect(sources.slice(first).every((source) => source === "skill")).toBe(true)
    expect(sources.slice(0, first).every((source) => source !== "skill")).toBe(true)
    ctx.dispose()
  })

  it("suffixes a skill that clashes with a command and drops exact duplicate rows", () => {
    const ctx = setup(() => {})
    loaded(ctx)
    ctx.slash.onInput("/", 1)
    const rows = ctx.slash
      .results()
      .filter((cmd) => !cmd.action)
      .map((cmd) => `${cmd.source ?? "command"}:${cmd.name}`)
    expect(rows.filter((row) => row.endsWith(":foo"))).toEqual(["command:foo"])
    expect(rows.filter((row) => row.startsWith("skill:"))).toEqual(["skill:foo:skill", "skill:grill"])
    ctx.dispose()
  })

  it("inserts /name:skill when the clashing skill row is selected", () => {
    const ctx = setup(() => {})
    loaded(ctx)
    let text = ""
    const textarea = { value: "/foo", setSelectionRange: () => {}, focus: () => {} } as unknown as HTMLTextAreaElement
    ctx.slash.onInput("/foo", 4)
    const entry = ctx.slash.results().find((cmd) => cmd.source === "skill" && cmd.name.startsWith("foo"))!
    ctx.slash.select(entry, textarea, (value) => (text = value))
    expect(text.startsWith("/foo:skill")).toBe(true)
    ctx.dispose()
  })

  it("still matches a clashing skill by its plain name", () => {
    const ctx = setup(() => {})
    loaded(ctx)
    ctx.slash.onInput("/foo", 4)
    const names = ctx.slash
      .results()
      .filter((cmd) => !cmd.action)
      .map((cmd) => cmd.name)
    expect(names).toEqual(["foo", "foo:skill"])
    ctx.dispose()
  })
})

describe("slash command keyboard selection", () => {
  it.each(["verify"])("leaves Shift+Tab unhandled with /%s selected", (name) => {
    const draft = `/${name} keep this draft`
    const state = { text: draft, prevented: 0, selected: 0, toggles: 0 }
    const ctx = setup(() => state.toggles++)
    const cursor = name.length + 1
    const textarea = {
      value: draft,
      selectionStart: cursor,
      setSelectionRange: (start: number) => (textarea.selectionStart = start),
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const event = {
      key: "Tab",
      shiftKey: true,
      isComposing: false,
      preventDefault: () => state.prevented++,
    } as unknown as KeyboardEvent

    ctx.fire({
      type: "commandsLoaded",
      commands: [{ name: "verify", description: "Verify changes", hints: [] }],
    })
    ctx.slash.onInput(draft, cursor)
    expect(ctx.slash.results()[0]?.name).toBe(name)

    const handled = ctx.slash.onKeyDown(
      event,
      textarea,
      (text) => (state.text = text),
      () => state.selected++,
    )

    expect(handled).toBe(false)
    expect(state).toEqual({ text: draft, prevented: 0, selected: 0, toggles: 0 })
    expect(textarea.value).toBe(draft)
    expect(textarea.selectionStart).toBe(cursor)
    expect(ctx.slash.show()).toBe(true)
    expect(ctx.slash.index()).toBe(0)
    expect(ctx.sent).toEqual([{ type: "requestCommands" }])
    ctx.dispose()
  })

  it.each(["Enter", "Tab"] as const)("keeps %s selection aligned with the action-first menu", (key) => {
    const state = { text: "/refresh", prevented: 0 }
    const ctx = setup(() => {})
    const textarea = {
      value: state.text,
      selectionStart: state.text.length,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const event = {
      key,
      isComposing: false,
      preventDefault: () => state.prevented++,
    } as unknown as KeyboardEvent

    ctx.slash.onInput(state.text, state.text.length)
    ctx.fire({
      type: "commandsLoaded",
      commands: [{ name: "refresh", description: "Run the custom refresh command", hints: [] }],
    })

    expect(ctx.slash.results().map((command) => command.name)).toEqual(["reload", "refresh"])
    const handled = ctx.slash.onKeyDown(event, textarea, (text) => (state.text = text))

    expect(handled).toBe(true)
    expect(state.prevented).toBe(1)
    expect(state.text).toBe("")
    expect(textarea.value).toBe("")
    expect(ctx.sent).toEqual([{ type: "requestCommands" }, { type: "reload" }])
    ctx.dispose()
  })

  it("selects the second displayed result after ArrowDown", () => {
    const state = { text: "/refresh", prevented: 0 }
    const ctx = setup(() => {})
    const textarea = {
      value: state.text,
      selectionStart: state.text.length,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    ctx.slash.onInput(state.text, state.text.length)
    ctx.fire({
      type: "commandsLoaded",
      commands: [{ name: "refresh", description: "Run the custom refresh command", hints: [] }],
    })

    const down = {
      key: "ArrowDown",
      isComposing: false,
      preventDefault: () => state.prevented++,
    } as unknown as KeyboardEvent
    const enter = {
      key: "Enter",
      isComposing: false,
      preventDefault: () => state.prevented++,
    } as unknown as KeyboardEvent

    expect(ctx.slash.onKeyDown(down, textarea, (text) => (state.text = text))).toBe(true)
    expect(ctx.slash.index()).toBe(1)
    expect(ctx.slash.onKeyDown(enter, textarea, (text) => (state.text = text))).toBe(true)

    expect(state.prevented).toBe(2)
    expect(state.text).toBe("/refresh ")
    expect(textarea.value).toBe("/refresh ")
    expect(ctx.sent).toEqual([{ type: "requestCommands" }])
    ctx.dispose()
  })
})

describe("select", () => {
  it("preserves trailing text for action commands", () => {
    let actionCalls = 0
    let currentText = "existing text"
    const ctx = setup(() => {})

    const textarea = {
      value: "/newexisting text",
      selectionStart: 4,
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    ctx.slash.select(
      {
        name: "new",
        description: "Start a new session",
        hints: [],
        action: () => {
          actionCalls++
        },
      },
      textarea,
      setText,
    )

    expect(textarea.value).toBe("existing text")
    expect(currentText).toBe("existing text")
    expect(actionCalls).toBe(1)
    ctx.dispose()
  })

  it("preserves trailing text for server commands and sets cursor", () => {
    const ctx = setup(() => {})
    let currentText = ""
    let selectionStart = 0

    const textarea = {
      value: "/docmdexisting text",
      selectionStart: 6,
      setSelectionRange: (start: number, end: number) => {
        selectionStart = start
      },
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    ctx.slash.select({ name: "docmd", description: "Run doc command", hints: [] }, textarea, setText)

    expect(textarea.value).toBe("/docmd existing text")
    expect(currentText).toBe("/docmd existing text")
    expect(selectionStart).toBe("/docmd ".length)
    ctx.dispose()
  })

  it("uses slashEnd for server commands when onInput fired before select", () => {
    const ctx = setup(() => {})
    let currentText = ""
    let selectionStart = 0

    ctx.slash.onInput("/docmdexisting text", 6)

    const textarea = {
      value: "/docmdexisting text",
      selectionStart: 2,
      setSelectionRange: (start: number, end: number) => {
        selectionStart = start
      },
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    ctx.slash.select({ name: "docmd", description: "Run doc command", hints: [] }, textarea, setText)

    expect(textarea.value).toBe("/docmd existing text")
    expect(currentText).toBe("/docmd existing text")
    expect(selectionStart).toBe("/docmd ".length)
    ctx.dispose()
  })

  it("preserves trailing text even when cursor moves after typing slash command", () => {
    let actionCalls = 0
    let currentText = "existing text"
    const ctx = setup(() => {})

    // Type slash command: cursor at 4, slashEnd stored as 4
    ctx.slash.onInput("/newexisting text", 4)

    // Simulate user moving cursor (e.g. ArrowLeft twice)
    const textarea = {
      value: "/newexisting text",
      selectionStart: 2,
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    ctx.slash.select(
      {
        name: "new",
        description: "Start a new session",
        hints: [],
        action: () => {
          actionCalls++
        },
      },
      textarea,
      setText,
    )

    // Should preserve trailing text from original slashEnd (4), not stale selectionStart (2)
    expect(textarea.value).toBe("existing text")
    expect(currentText).toBe("existing text")
    expect(actionCalls).toBe(1)
    ctx.dispose()
  })

})
