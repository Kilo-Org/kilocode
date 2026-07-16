import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { SyntaxStyle, type MouseEvent } from "@opentui/core"
import { AssistantLink } from "@/kilocode/cli/cmd/tui/assistant-link"

const active: Awaited<ReturnType<typeof testRender>>[] = []

afterEach(() => {
  for (const app of active.splice(0)) app.renderer.destroy()
})

describe("assistant link Ghostty fallback", () => {
  test("enables only in macOS Ghostty", () => {
    expect(AssistantLink.ghostty({ platform: "darwin", env: { TERM_PROGRAM: "ghostty" } })).toBe(true)
    expect(AssistantLink.ghostty({ platform: "darwin", env: { TERM: "xterm-ghostty" } })).toBe(true)
    expect(AssistantLink.ghostty({ platform: "linux", env: { TERM_PROGRAM: "ghostty" } })).toBe(false)
    expect(AssistantLink.ghostty({ platform: "darwin", env: { TERM_PROGRAM: "iTerm.app" } })).toBe(false)
  })

  test("accepts only descendants of final assistant text parts", () => {
    const assistant = { id: "assistant-text-part-1", parent: null }
    expect(AssistantLink.target({ id: "assistant-text-code", parent: assistant })).toBe(true)
    expect(AssistantLink.target({ id: "text-reasoning", parent: null })).toBe(false)
    expect(AssistantLink.target({ id: "dialog-link", parent: null })).toBe(false)
    expect(AssistantLink.target(null)).toBe(false)
  })
})

// Mirrors the production nesting (an ancestor box plus TextPart's own
// paddingLeft={3}) so wrapped content never starts at buffer column 0,
// exercising the same offsets a real assistant message renders with.
async function renderMarkdown(content: string, width = 80) {
  const syntax = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })
  const app = await testRender(
    () => (
      <box paddingLeft={2} width={width + 5}>
        <box id="assistant-text-part-1" paddingLeft={3} width={width}>
          <markdown syntaxStyle={syntax} content={content} conceal={true} />
        </box>
      </box>
    ),
    { width: width + 5, height: 8 },
  )
  active.push(app)
  // The markdown renderable finishes tree-sitter highlighting asynchronously.
  // The test renderer has no active render loop here, so poll by repeatedly
  // driving renderOnce() until the frame stops changing, rather than a fixed
  // delay that can be too short on a slower or more loaded CI runner.
  let previous = ""
  for (let i = 0; i < 100; i++) {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    if (frame === previous && frame.trim().length > 0) return app
    previous = frame
    await Bun.sleep(10)
  }
  return app
}

function point(frame: string, text: string) {
  const offset = frame.indexOf(text)
  expect(offset).toBeGreaterThanOrEqual(0)
  const width = frame.indexOf("\n") + 1
  return { x: offset % width, y: Math.floor(offset / width) }
}

describe("assistant link hyperlink resolution", () => {
  // OpenTUI's real renderer only attaches native hyperlink metadata to the
  // URL substring of a `[label](url)` Markdown link, never to the label
  // text. With `conceal` on (the product default), that URL substring is
  // always rendered right next to the label as `Label (url)`, so it remains
  // directly clickable; clicking the styled label word itself is not
  // supported because OpenTUI exposes no metadata there to resolve.
  test("resolves the visible URL substring of a labeled link and a bare URL", async () => {
    const app = await renderMarkdown("[Kilo](https://kilo.ai) https://example.com")
    const frame = app.captureCharFrame()
    const labeled = point(frame, "https://kilo.ai")
    const bare = point(frame, "https://example.com")

    expect(AssistantLink.url(app.renderer, labeled.x, labeled.y)).toBe("https://kilo.ai")
    expect(AssistantLink.url(app.renderer, bare.x, bare.y)).toBe("https://example.com")
  })

  test("does not resolve a click on the label word itself", async () => {
    const app = await renderMarkdown("[Kilo](https://kilo.ai)")
    const labeled = point(app.captureCharFrame(), "Kilo")

    expect(AssistantLink.url(app.renderer, labeled.x, labeled.y)).toBeUndefined()
  })

  test("resolves every row of a wrapped bare URL", async () => {
    const app = await renderMarkdown("https://example.com/a/long/path/that/wraps", 20)
    const frame = app.captureCharFrame()
    const first = point(frame, "https://example")
    const second = point(frame, "wraps")

    expect(AssistantLink.url(app.renderer, first.x, first.y)).toBe("https://example.com/a/long/path/that/wraps")
    expect(AssistantLink.url(app.renderer, second.x, second.y)).toBe("https://example.com/a/long/path/that/wraps")
  })

  test("trims trailing prose punctuation from a bare URL", async () => {
    const app = await renderMarkdown("see (https://kilo.ai) for details.")
    const bare = point(app.captureCharFrame(), "https://kilo.ai")

    expect(AssistantLink.url(app.renderer, bare.x, bare.y)).toBe("https://kilo.ai")
  })

  test("keeps a balanced parenthesis that is genuinely part of the URL", async () => {
    const app = await renderMarkdown("https://en.wikipedia.org/wiki/Foo_(bar)")
    const bare = point(app.captureCharFrame(), "https://en.wikipedia.org")

    expect(AssistantLink.url(app.renderer, bare.x, bare.y)).toBe("https://en.wikipedia.org/wiki/Foo_(bar)")
  })

  test("rejects unsupported schemes and unlinked cells", async () => {
    const app = await renderMarkdown("[mail](mailto:test@example.com) plain")
    const frame = app.captureCharFrame()
    const mail = point(frame, "mailto:test@example.com")
    const plain = point(frame, "plain")

    expect(AssistantLink.url(app.renderer, mail.x, mail.y)).toBeUndefined()
    expect(AssistantLink.url(app.renderer, plain.x, plain.y)).toBeUndefined()
  })
})

describe("assistant link fallback handler", () => {
  function event(overrides: Partial<{ button: number; x: number; y: number; target: { id: string; parent: null } | null }>) {
    return {
      button: overrides.button ?? 0,
      x: overrides.x ?? 0,
      y: overrides.y ?? 0,
      target: overrides.target ?? { id: "assistant-text-part-1", parent: null },
      preventDefault: () => {},
      stopPropagation: () => {},
    } as unknown as MouseEvent
  }

  test("launches once and consumes the event on macOS Ghostty for an assistant HTTP(S) cell", async () => {
    const app = await renderMarkdown("[Kilo](https://kilo.ai)")
    const p = point(app.captureCharFrame(), "https://kilo.ai")
    let launched: string | undefined
    const handled = AssistantLink.handle({
      renderer: app.renderer,
      event: event({ x: p.x, y: p.y }),
      platform: "darwin",
      env: { TERM_PROGRAM: "ghostty" },
      launch: async (url) => {
        launched = url
      },
    })

    expect(handled).toBe(true)
    expect(launched).toBe("https://kilo.ai")
  })

  test("does not intercept on macOS iTerm2 or Ghostty on Linux", async () => {
    const app = await renderMarkdown("[Kilo](https://kilo.ai)")
    const p = point(app.captureCharFrame(), "https://kilo.ai")
    let launched = false

    const iterm = AssistantLink.handle({
      renderer: app.renderer,
      event: event({ x: p.x, y: p.y }),
      platform: "darwin",
      env: { TERM_PROGRAM: "iTerm.app" },
      launch: async () => {
        launched = true
      },
    })
    const linuxGhostty = AssistantLink.handle({
      renderer: app.renderer,
      event: event({ x: p.x, y: p.y }),
      platform: "linux",
      env: { TERM_PROGRAM: "ghostty" },
      launch: async () => {
        launched = true
      },
    })

    expect(iterm).toBe(false)
    expect(linuxGhostty).toBe(false)
    expect(launched).toBe(false)
  })

  test("does not intercept a non-assistant target", async () => {
    const app = await renderMarkdown("[Kilo](https://kilo.ai)")
    const p = point(app.captureCharFrame(), "https://kilo.ai")
    let launched = false

    const handled = AssistantLink.handle({
      renderer: app.renderer,
      event: event({ x: p.x, y: p.y, target: { id: "text-reasoning", parent: null } }),
      platform: "darwin",
      env: { TERM_PROGRAM: "ghostty" },
      launch: async () => {
        launched = true
      },
    })

    expect(handled).toBe(false)
    expect(launched).toBe(false)
  })

  test("calls the error callback once when launch rejects", async () => {
    const app = await renderMarkdown("[Kilo](https://kilo.ai)")
    const p = point(app.captureCharFrame(), "https://kilo.ai")
    let errors = 0

    const handled = AssistantLink.handle({
      renderer: app.renderer,
      event: event({ x: p.x, y: p.y }),
      platform: "darwin",
      env: { TERM_PROGRAM: "ghostty" },
      launch: async () => {
        throw new Error("boom")
      },
      error: () => {
        errors += 1
      },
    })

    expect(handled).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errors).toBe(1)
  })
})
