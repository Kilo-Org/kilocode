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
  it("opens project memory actions from the top-level command", () => {
    const ctx = setup(() => {})
    const state = { text: "/memory" }
    const textarea = {
      value: state.text,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    ctx.slash.onInput("/mem", 4)

    expect(ctx.slash.results()).toContainEqual(
      expect.objectContaining({ name: "memory", description: "Manage project memory", hints: ["mem"] }),
    )
    ctx.slash.select(ctx.slash.results()[0]!, textarea, (text) => (state.text = text))
    expect(state.text).toBe("/memory ")
    expect(ctx.slash.results().map((command) => command.name)).toContain("memory inspect")
    ctx.dispose()
  })

  it("offers memory actions after the parent command", () => {
    const ctx = setup(() => {})

    ctx.slash.onInput("/memory ", 8)

    expect(ctx.slash.results().map((command) => command.name)).toEqual([
      "memory status",
      "memory show",
      "memory on",
      "memory off",
      "memory inspect",
      "memory rebuild",
      "memory remember",
      "memory correct",
      "memory forget",
      "memory auto on",
      "memory auto off",
      "memory purge confirm",
    ])
    ctx.dispose()
  })

  it("keeps nested memory actions out of root hint matching", () => {
    const ctx = setup(() => {})
    const nested = ctx.slash.commands().filter((command) => command.name.startsWith("memory "))

    expect(nested.length).toBeGreaterThan(0)
    expect(nested.every((command) => command.hints.length === 0)).toBe(true)
    ctx.dispose()
  })

  it("completes nested memory actions and closes for free text", () => {
    const ctx = setup(() => {})
    const state = { text: "/mem rem" }
    const textarea = {
      value: state.text,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    ctx.slash.onInput(state.text, state.text.length)
    expect(ctx.slash.results().map((command) => command.name)).toEqual(["memory remember"])
    ctx.slash.select(ctx.slash.results()[0]!, textarea, (text) => (state.text = text))
    expect(state.text).toBe("/memory remember ")

    ctx.slash.onInput("/memory remember durable fact", 31)
    expect(ctx.slash.show()).toBe(false)
    ctx.dispose()
  })

  it("runs the sandbox toggle as a client command", () => {
    const state = { toggles: 0, text: "/sandbox", prevented: 0 }
    const ctx = setup(() => state.toggles++)
    const textarea = { value: state.text } as HTMLTextAreaElement
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
    const textarea = { value: state.text } as HTMLTextAreaElement
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
