import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { useSlashCommand } from "../../webview-ui/src/hooks/useSlashCommand"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

function setup(sandbox: () => void, options: { enabled?: () => boolean; exclude?: () => Set<string> } = {}) {
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
      { action: sandbox, enabled: options.enabled ?? (() => true) },
      options.exclude,
    ),
  }))
  const fire = (message: ExtensionMessage) => {
    for (const handler of handlers) handler(message)
  }
  return { ...root, fire, sent }
}

describe("useSlashCommand sandbox action", () => {
  it("runs the sandbox toggle as a client command", () => {
    const state = { toggles: 0, text: "/sandbox", prevented: 0 }
    const ctx = setup(() => state.toggles++)
    const textarea = { value: state.text, selectionStart: state.text.length, setSelectionRange: () => {} } as HTMLTextAreaElement
    const event = {
      key: "Enter",
      isComposing: false,
      preventDefault: () => state.prevented++,
    } as unknown as KeyboardEvent

    ctx.slash.onInput(state.text, state.text.length)
    const handled = ctx.slash.onKeyDown(event, textarea, (text) => (state.text = text))

    expect(handled).toBe(true)
    expect(state.toggles).toBe(1)
    expect(state.prevented).toBe(1)
    expect(state.text).toBe("")
    expect(textarea.value).toBe("")
    expect(ctx.sent).toEqual([{ type: "requestCommands" }])
    ctx.dispose()
  })

  it("keeps the command text when the sandbox control is disabled", () => {
    const state = { toggles: 0, text: "/sandbox" }
    const ctx = setup(() => state.toggles++, { enabled: () => false })
    const textarea = { value: state.text, selectionStart: state.text.length, setSelectionRange: () => {} } as HTMLTextAreaElement
    const event = {
      key: "Enter",
      isComposing: false,
      preventDefault: () => {},
    } as unknown as KeyboardEvent

    ctx.slash.onInput(state.text, state.text.length)
    const handled = ctx.slash.onKeyDown(event, textarea, (text) => (state.text = text))

    expect(handled).toBe(true)
    expect(state.toggles).toBe(0)
    expect(state.text).toBe("/sandbox")
    expect(textarea.value).toBe("/sandbox")
    ctx.dispose()
  })

  it("hides the client and server sandbox command when excluded", () => {
    const state = { hidden: true }
    const ctx = setup(() => {}, {
      exclude: () => (state.hidden ? new Set(["sandbox"]) : new Set()),
    })

    ctx.slash.onInput("/sandbox", 8)
    ctx.fire({
      type: "commandsLoaded",
      commands: [{ name: "sandbox", description: "Server sandbox command", hints: [] }],
    })
    expect(ctx.slash.results()).toEqual([])

    state.hidden = false
    expect(ctx.slash.results().map((command) => command.name)).toEqual(["sandbox"])
    expect(ctx.slash.results()[0]?.description).toBe("Toggle sandbox")
    ctx.dispose()
  })
})

describe("select", () => {
  it("preserves trailing text for action commands", () => {
    let actionCalls = 0
    let currentText = "existing text"
    const ctx = setup(() => {})

    const textarea = { value: "/newexisting text", selectionStart: 4, setSelectionRange: () => {} } as unknown as HTMLTextAreaElement
    const setText = (text: string) => { currentText = text }

    ctx.slash.select(
      { name: "new", description: "Start a new session", hints: [], action: () => { actionCalls++ } },
      textarea,
      setText
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

    const textarea = { value: "/docmdexisting text", selectionStart: 6, setSelectionRange: (start: number, end: number) => { selectionStart = start }, focus: () => {} } as unknown as HTMLTextAreaElement
    const setText = (text: string) => { currentText = text }

    ctx.slash.select(
      { name: "docmd", description: "Run doc command", hints: [] },
      textarea,
      setText
    )

    expect(textarea.value).toBe("/docmd existing text")
    expect(currentText).toBe("/docmd existing text")
    expect(selectionStart).toBe("/docmd existing text".length)
    ctx.dispose()
  })

})