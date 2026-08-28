import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useSlashCommand } from "../../webview-ui/src/hooks/useSlashCommand"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

function setup(
  sandbox: () => void,
  options: { enabled?: () => boolean; exclude?: () => Set<string>; include?: Set<string> } = {},
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
      { action: sandbox, enabled: options.enabled ?? (() => true) },
      options.exclude,
      options.include,
    ),
  }))
  const fire = (message: ExtensionMessage) => {
    for (const handler of handlers) handler(message)
  }
  return { ...root, fire, sent }
}

describe("useSlashCommand sandbox action", () => {
  it("supports the singular model alias", () => {
    const ctx = setup(() => {})

    ctx.slash.onInput("/model", 6)

    expect(ctx.slash.results()[0]).toEqual(expect.objectContaining({ name: "models", hints: ["model"] }))
    ctx.dispose()
  })

  it("can restrict the menu to worktree configuration commands", () => {
    const ctx = setup(() => {}, { include: new Set(["models", "agents", "variant", "sandbox"]) })

    ctx.fire({
      type: "commandsLoaded",
      commands: [
        { name: "merge", description: "Merge changes", hints: [] },
        { name: "models", description: "Server model command", hints: [] },
      ],
    })
    ctx.slash.onInput("/merge", 6)
    expect(ctx.slash.results()).toEqual([])

    ctx.slash.onInput("/models", 7)
    expect(ctx.slash.results().map((command) => command.name)).toEqual(["models"])
    ctx.dispose()
  })

  it("opens project memory actions from the top-level command", () => {
    const ctx = setup(() => {})
    const state = { text: "/mem" }
    const textarea = {
      value: state.text,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    ctx.slash.onInput(state.text, state.text.length)

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
    const textarea = {
      value: state.text,
      selectionStart: state.text.length,
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement
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
    const textarea = {
      value: state.text,
      selectionStart: state.text.length,
      setSelectionRange: () => {},
    } as unknown as HTMLTextAreaElement
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

  it("opens review options from the top-level command", () => {
    const ctx = setup(() => {})
    const state = { text: "/review" }
    const textarea = {
      value: state.text,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    ctx.slash.onInput(state.text, state.text.length)

    expect(ctx.slash.results()).toContainEqual(
      expect.objectContaining({ name: "review", description: expect.stringContaining("Review code changes") }),
    )
    expect(ctx.slash.results().find((command) => command.name === "review")?.description).not.toContain("worktree")
    ctx.slash.select(ctx.slash.results().find((c) => c.name === "review")!, textarea, (text) => (state.text = text))
    expect(state.text).toBe("/review ")
    expect(ctx.slash.results().map((command) => command.name)).toEqual([
      "review uncommitted",
      "review staged",
      "review unpushed",
      "review branch",
      "review worktree",
      "review quick",
    ])
    ctx.dispose()
  })

  it("completes nested review actions and closes for free text", () => {
    const ctx = setup(() => {})
    const state = { text: "/review unp" }
    const textarea = {
      value: state.text,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement

    ctx.slash.onInput(state.text, state.text.length)
    expect(ctx.slash.results().map((command) => command.name)).toEqual(["review unpushed"])
    ctx.slash.select(ctx.slash.results()[0]!, textarea, (text) => (state.text = text))
    expect(state.text).toBe("/review unpushed ")

    ctx.slash.onInput("/review focus on auth", 20)
    expect(ctx.slash.show()).toBe(false)
    ctx.dispose()
  })

  it("reactively re-includes worktree review without changing nested ordering", () => {
    const [allowed, setAllowed] = createSignal(false)
    const ctx = setup(() => {}, { exclude: () => (allowed() ? new Set() : new Set(["review worktree"])) })

    ctx.slash.onInput("/review ", 8)
    expect(ctx.slash.results().map((command) => command.name)).toEqual([
      "review uncommitted",
      "review staged",
      "review unpushed",
      "review branch",
      "review quick",
    ])

    setAllowed(true)
    expect(ctx.slash.results().map((command) => command.name)).toEqual([
      "review uncommitted",
      "review staged",
      "review unpushed",
      "review branch",
      "review worktree",
      "review quick",
    ])
    ctx.dispose()
  })

  it("preserves model, agent, and variant metadata on loaded server commands", () => {
    const ctx = setup(() => {})

    ctx.fire({
      type: "commandsLoaded",
      commands: [
        {
          name: "ship",
          description: "Ship PR",
          agent: "code",
          model: "openai/gpt-5.6-luna-fast",
          variant: "xhigh",
          hints: ["deploy"],
        },
      ],
    })

    ctx.slash.onInput("/ship", 5)
    const matches = ctx.slash.results()
    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe("ship")
    expect(matches[0]?.agent).toBe("code")
    expect(matches[0]?.model).toBe("openai/gpt-5.6-luna-fast")
    expect(matches[0]?.variant).toBe("xhigh")
    ctx.dispose()
  })
})

describe("slash command keyboard selection", () => {
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

  it("preserves trailing text for memory commands when cursor moves", () => {
    let currentText = ""
    const ctx = setup(() => {})

    // Type /memory rem: matches memory pattern, slashEnd set to end of text
    const typed = "/memory rem"
    ctx.slash.onInput(typed, typed.length)

    // Simulate user moving cursor (no onInput fires for arrow keys)
    const textarea = {
      value: typed,
      selectionStart: 3,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    // Find the memory remember command (nested, no action)
    const remembered = ctx.slash.results().find((c) => c.name === "memory remember")
    expect(remembered).toBeDefined()

    ctx.slash.select(remembered!, textarea, setText)

    // Trailing text from slashEnd (end of typed text) — empty — should be preserved correctly
    expect(currentText).toBe("/memory remember ")
    expect(textarea.value).toBe("/memory remember ")
    ctx.dispose()
  })

  it("preserves trailing text through the two-step nested command path", () => {
    let currentText = ""
    const ctx = setup(() => {})

    ctx.slash.onInput("/mem", 4)

    const textarea = {
      value: "/mem",
      selectionStart: 4,
      setSelectionRange: () => {},
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    const memory = ctx.slash.results().find((c) => c.name === "memory")
    expect(memory).toBeDefined()
    ctx.slash.select(memory!, textarea, setText)
    expect(currentText).toBe("/memory ")
    expect(textarea.value).toBe("/memory ")

    const remember = ctx.slash.results().find((c) => c.name === "memory remember")
    expect(remember).toBeDefined()
    ctx.slash.select(remember!, textarea, setText)
    expect(currentText).toBe("/memory remember ")
    expect(textarea.value).toBe("/memory remember ")
    ctx.dispose()
  })

  it("keeps trailing text and cursor before it through nested selection", () => {
    const ctx = setup(() => {})
    let currentText = "hello"
    const textarea = {
      value: "hello",
      selectionStart: 0,
      setSelectionRange: (start: number, _end: number) => {
        textarea.selectionStart = start
      },
      focus: () => {},
    } as unknown as HTMLTextAreaElement
    const setText = (text: string) => {
      currentText = text
    }

    textarea.value = "/memhello"
    textarea.selectionStart = 4
    ctx.slash.onInput("/memhello", 4)

    const memory = ctx.slash.results().find((c) => c.name === "memory")
    expect(memory).toBeDefined()
    ctx.slash.select(memory!, textarea, setText)
    expect(textarea.value).toBe("/memory hello")
    expect(textarea.selectionStart).toBe("/memory ".length)

    const rebuild = ctx.slash.results().find((c) => c.name === "memory rebuild")
    expect(rebuild).toBeDefined()
    ctx.slash.select(rebuild!, textarea, setText)

    expect(textarea.value).toBe("/memory rebuild hello")
    expect(textarea.selectionStart).toBe("/memory rebuild ".length)
    ctx.dispose()
  })
})
