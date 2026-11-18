import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Config } from "@opencode/core/config"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/schema/tool"
import { Effect, Exit, Queue, Scope, Stream } from "effect"
import type { CallContext } from "../../src/browser/backend"
import { BrowserContract } from "../../src/browser/contract"
import { key, outputDirectory, playwright } from "../../src/browser/playwright"
import { resolve } from "../../src/browser/settings"
import { grantsFor, KiloBrowserToolsPlugin, resetGrants } from "../../src/browser/tools"

/**
 * The backend's own call path, over a stand-in browser and MCP client. The helpers above are pure; these drive
 * `callTool` for real, so a guard removed from the call path fails a test instead of only losing helper coverage.
 */
type Call = { name: string; args: Record<string, unknown> }

type Text = (name: string, args: Record<string, unknown>) => string

type World = {
  pages: Page[]
  calls: Call[]
  text: Text
  onCall?: (name: string, args: Record<string, unknown>) => void
  onDownload?: (download: unknown) => void
  closed: number
}

const state: World = { pages: [], calls: [], text: () => "", closed: 0 }

/** A page object with the surface the backend reads: its URL, its frame tree, and a ref lookup that finds nothing. */
class Page {
  children: Page[] = []

  constructor(
    readonly id: string,
    public value: string,
  ) {}

  url() {
    return this.value
  }

  mainFrame() {
    return this
  }

  childFrames(): Page[] {
    return this.children
  }

  parentFrame(): null {
    return null
  }

  locator() {
    return { elementHandle: async () => null }
  }

  async waitForTimeout() {}
}

/** The Chromium the backend would launch; the file only has to exist, because the launch itself is stand-in. */
let executable = ""

const pageText = [
  "### Page",
  "- Page URL: https://gate.example.com/",
  "- Page Title: Gate",
  "### Snapshot",
  "```yaml",
  '- button "Go" [ref=e1]',
  "```",
].join("\n")

mock.module("playwright-core", () => ({
  chromium: {
    executablePath: () => executable,
    launch: async () => ({
      on() {},
      off() {},
      async close() {
        state.closed += 1
      },
      async newContext() {
        return {
          pages: () => state.pages,
          on(event: string, handler: (download: unknown) => void) {
            if (event === "download") state.onDownload = handler
          },
          off() {},
          async close() {
            state.closed += 1
          },
        }
      },
    }),
  },
}))

mock.module("@playwright/mcp", () => ({
  createConnection: async () => ({ connect: async () => {}, close: async () => {} }),
}))

mock.module("@modelcontextprotocol/client", () => ({
  Client: class {
    async connect() {}
    async listTools() {
      const entry = BrowserContract.entries[0]
      return {
        tools: [
          {
            name: entry.name,
            description: entry.description,
            inputSchema: entry.inputSchema,
            annotations: { title: entry.title, readOnlyHint: entry.readOnly },
          },
        ],
      }
    }
    async callTool(request: { name: string; arguments: Record<string, unknown> }) {
      state.calls.push({ name: request.name, args: request.arguments })
      state.onCall?.(request.name, request.arguments)
      return { content: [{ type: "text", text: state.text(request.name, request.arguments) }], isError: false }
    }
    async close() {}
  },
}))

const context = { session: "ses_guards" } as CallContext

async function browser() {
  return playwright.get(key(resolve(undefined)))
}

beforeEach(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-browser-guards-"))
  executable = path.join(directory, "chrome")
  await fs.writeFile(executable, "")
  state.pages = [new Page("a", "https://gate.example.com/")]
  state.calls = []
  state.closed = 0
  state.onCall = undefined
  state.text = (name) =>
    name === "browser_console_messages" ? "### Result\n- [ERROR] boom @ https://gate.example.com/app.js" : pageText
})

afterEach(async () => {
  await playwright.dispose()
  // The grant cache is module-level: one test's grants must never satisfy the next test's plan.
  resetGrants()
})

/** One plugin location; its scope close runs the finalizers, which is the shutdown path under test. */
async function boot(options: { permission?: unknown; events?: unknown } = {}) {
  const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
  const ctx = {
    location: { directory: "/tmp/browser-guards-test" },
    tool: {
      transform: (fn: (typeof transforms)[number]) =>
        Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
    },
    event: { subscribe: () => options.events ?? Stream.empty },
    permission: { hook: () => Effect.sync(() => ({ dispose: Effect.void })) },
  }
  const config = { entries: () => Effect.succeed([]) } as unknown as Config.Interface
  const scope = await Effect.runPromise(Scope.make())
  const plugin = KiloBrowserToolsPlugin.effect(ctx as never).pipe(
    Effect.provideService(Scope.Scope, scope),
    Effect.provideService(Config.Service, config),
  )
  await Effect.runPromise(
    options.permission ? plugin.pipe(Effect.provideService(Permission.Service, options.permission as never)) : plugin,
  )
  const tools = () => {
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    return added
  }
  const call = (name: string, input: unknown = {}, session = "ses_guards_plugin") =>
    Effect.runPromise(
      Effect.result(
        tools()
          .find((tool) => tool.name === name)!
          .execute(input, {
            sessionID: session as never,
            agent: "code" as never,
            messageID: "msg_guards" as never,
            id: "call_guards" as never,
            progress: () => Effect.void,
          }),
      ),
    )
  return { call, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
}

/** Run a call to completion and return its failure, so the recorded MCP traffic can be asserted as well. */
async function settle(promise: Promise<unknown>) {
  try {
    await promise
    return undefined
  } catch (error) {
    return error
  }
}

function textOf(result: unknown) {
  if (!result || typeof result !== "object" || !("success" in result)) return ""
  const success = result.success
  if (!success || typeof success !== "object" || !("content" in success) || !Array.isArray(success.content)) return ""
  return success.content
    .flatMap((block: unknown) => {
      if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text") return []
      if (!("text" in block) || typeof block.text !== "string") return []
      return [block.text]
    })
    .join("\n")
}

describe("the backend's call path", () => {
  test("a tab that lands on a refused scheme is refused after the call", async () => {
    const page = state.pages[0]
    state.onCall = (name) => {
      if (name === "browser_tabs") page.value = "file:///etc/passwd"
    }
    const backend = await browser()
    await expect(backend.callTool("browser_tabs", { action: "new" }, context)).rejects.toThrow("Navigation refused")
    // The tab really opened: the refusal came from the landing page, not from the requested arguments.
    expect(state.calls.map((call) => call.name)).toEqual(["browser_tabs"])
  })

  test("a new tab's own url is refused before the browser sees it", async () => {
    const backend = await browser()
    // A refused scheme never reaches the browser, whatever the call would otherwise do with it.
    const error = await settle(backend.callTool("browser_tabs", { action: "new", url: "file:///etc/passwd" }, context))
    expect(state.calls).toEqual([])
    expect(error instanceof Error ? error.message : String(error)).toContain("Navigation refused")
  })

  test("a model filename outside the output directory is refused before the call", async () => {
    const backend = await browser()
    const error = await settle(
      backend.callTool("browser_snapshot", { filename: path.join(path.sep, "tmp", "escape.png") }, context),
    )
    expect(state.calls).toEqual([])
    expect(error instanceof Error ? error.message : String(error)).toContain("output directory")
    // Inside the directory the backend writes the file itself, from the filtered text; the MCP never sees the name.
    await backend.callTool("browser_snapshot", { filename: "page.yml" }, context)
    expect(state.calls[0]?.args.filename).toBeUndefined()
    expect((await fs.stat(path.join(outputDirectory(), "page.yml")).catch(() => null))?.isFile()).toBe(true)
  })

  test("the current page is tracked per session, not taken from tool text", async () => {
    const backend = await browser()
    const one = await backend.callTool("browser_click", {}, { session: "ses_one" } as CallContext)
    state.onCall = () => {
      state.pages.push(new Page("b", "https://other.example.com/"))
    }
    const two = await backend.callTool("browser_click", {}, { session: "ses_two" } as CallContext)
    state.onCall = undefined
    const back = await backend.callTool("browser_click", {}, { session: "ses_one" } as CallContext)
    // The second session opened a tab; the first session still inspects its own page.
    expect(two.meta?.url).toBe("https://other.example.com/")
    expect(one.meta?.url).toBe("https://gate.example.com/")
    expect(back.meta?.url).toBe("https://gate.example.com/")
  })
})

describe("a grant a withheld result asked for", () => {
  const rejection =
    "This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action."

  test("a refused post-action ask keeps the withheld result and says the action ran", async () => {
    // The plan's own asks are allowed; only the ask for the origin the action landed on is refused.
    const host = await boot({
      permission: {
        assert: (input: { resources: readonly string[] }) =>
          Effect.suspend(() =>
            input.resources.some((resource) => String(resource).includes("other.example.com"))
              ? Effect.fail(new Error(rejection))
              : Effect.void,
          ),
      },
    })
    const page = state.pages[0]
    state.onCall = (name) => {
      if (name === "browser_click") page.value = "https://other.example.com/landed"
    }
    const result = await host.call("browser_click", {})
    const text = textOf(result)
    expect(text).toContain("- Page URL: https://other.example.com/landed")
    expect(text).toContain("the action ran")
    expect(text).not.toContain("cannot ask the user")
    // Only the URL: the title is content of an origin this session was never granted.
    expect(text).not.toContain("- Page Title:")
    // The click ran exactly once: the refusal never replayed it.
    expect(state.calls.filter((call) => call.name === "browser_click").length).toBe(1)
  })

  test("a refused pre-action ask keeps the existing rejection message", async () => {
    const host = await boot({
      permission: { assert: () => Effect.fail(new Error(rejection)) },
    })
    const outcome = (await host.call("browser_snapshot", {})) as { failure?: Error }
    expect(String(outcome.failure?.message ?? "")).toContain("cannot ask the user for permission")
    // Nothing ran.
    expect(state.calls).toEqual([])
  })
})

describe("a result file the MCP would write", () => {
  const snapshotText = [
    "### Page",
    "- Page URL: https://gate.example.com/",
    "- Page Title: Gate",
    "### Snapshot",
    "```yaml",
    "- generic [ref=e1]:",
    "  - iframe [ref=e2]:",
    '    - heading "IFRAME-MARKER" [level=1]',
    '  - heading "Gate" [level=1]',
    "```",
  ].join("\n")

  test("a saved snapshot holds the filtered snapshot, not the withheld frame", async () => {
    const parent = state.pages[0]
    parent.children = [new Page("b", "https://pay.example.net/")]
    state.text = () => snapshotText
    const backend = await browser()
    await backend.callTool("browser_snapshot", { filename: "nested/dir/snap.yml" }, context)
    const body = await fs.readFile(path.join(outputDirectory(), "nested", "dir", "snap.yml"), "utf8")
    expect(body).not.toContain("IFRAME-MARKER")
    expect(body).toContain('heading "Gate"')
    expect(state.calls[0]?.args.filename).toBeUndefined()
  })

  test("a saved console file holds the filtered console, not a withheld origin's line", async () => {
    const parent = state.pages[0]
    parent.children = [new Page("b", "https://pay.example.net/")]
    state.text = () =>
      [
        "### Result",
        "Total messages: 2 (Errors: 1, Warnings: 0)",
        "",
        "[LOG] page @ https://gate.example.com/app.js:1",
        "[ERROR] card declined @ https://pay.example.net/checkout.js:8",
      ].join("\n")
    const backend = await browser()
    // The page origin is granted; only the withheld frame's line may not reach the file.
    await backend.callTool(
      "browser_console_messages",
      { level: "error", filename: "console/run.log" },
      { ...context, authorized: ["read:https://gate.example.com"] },
    )
    const body = await fs.readFile(path.join(outputDirectory(), "console", "run.log"), "utf8")
    expect(body).not.toContain("pay.example.net")
    expect(body).toContain("https://gate.example.com/app.js:1")
    expect(state.calls[0]?.args.filename).toBeUndefined()
  })
})

describe("a download the action started", () => {
  test("asks after the action, and never repeats the click", async () => {
    const cancelled: string[] = []
    const backend = await browser()
    state.onCall = (name) => {
      if (name !== "browser_click") return
      state.onDownload?.({
        suggestedFilename: () => "invoice.pdf",
        cancel: async () => {
          cancelled.push("invoice.pdf")
        },
      })
    }
    const result = await backend.callTool("browser_click", {}, context)
    // The click ran once, its download was stopped, and the result asks through the post-action path.
    expect(state.calls.filter((call) => call.name === "browser_click").length).toBe(1)
    expect(cancelled).toEqual(["invoice.pdf"])
    expect(result.meta?.needs).toEqual([
      { class: "sensitive", origin: "https://gate.example.com", reason: "download: invoice.pdf" },
    ])
    expect((result.content[0] as { text: string }).text).toContain("needs the user's permission")
  })
})

describe("a result file this call did not write", () => {
  test("survives another session's masked screenshot", async () => {
    const other = path.join(outputDirectory(), "other-session.png")
    const mine = path.join(outputDirectory(), "mine.png")
    await fs.mkdir(outputDirectory(), { recursive: true })
    await fs.writeFile(other, "keep")
    await fs.writeFile(mine, "drop")
    const parent = state.pages[0]
    parent.children = [new Page("b", "https://pay.example.net/")]
    // The MCP reports the file it wrote; only that file may be removed, never the shared directory's neighbours.
    state.text = () => `### Result\n// Screenshot viewport and save it as ${mine}`
    const backend = await browser()
    await backend.callTool("browser_take_screenshot", { type: "png", scale: "css" }, context)
    expect((await fs.stat(other).catch(() => null))?.isFile()).toBe(true)
    expect(await fs.stat(mine).catch(() => null)).toBeNull()
  })
})

describe("the diff console read", () => {
  test("skips the section when the tool rule is deny or ask", async () => {
    const host = await boot({
      permission: {
        assert: () => Effect.void,
        allows: () => Effect.succeed(false),
      },
    })
    // A first read grants the page, so nothing but the tool rule can stop the console section.
    await host.call("browser_snapshot", {})
    const result = await host.call("browser_click", {})
    expect(state.calls.map((call) => call.name)).toEqual(["browser_snapshot", "browser_click"])
    expect(textOf(result)).not.toContain("Console errors")
  })

  test("returns the re-read page, and the action still ran once", async () => {
    const host = await boot({ permission: { assert: () => Effect.void } })
    const page = state.pages[0]
    state.onCall = (name) => {
      if (name === "browser_click") page.value = "https://other.example.com/landed"
    }
    const result = await host.call("browser_click", {})
    const text = textOf(result)
    // The placeholder is replaced by a fresh read of the page (diff mode reports the page, not the button).
    expect(text).toContain("### Page")
    expect(text).not.toContain("The page moved to")
    // Reading has no side effect: the click ran once and the re-read is a snapshot.
    expect(state.calls.filter((call) => call.name === "browser_click").length).toBe(1)
    expect(state.calls.filter((call) => call.name === "browser_snapshot").length).toBe(1)
  })
})

describe("a deleted session", () => {
  test("releases its grants", async () => {
    const queue = await Effect.runPromise(Queue.unbounded<never>())
    await boot({ events: Stream.fromQueue(queue) })
    grantsFor("ses_event").add("read:https://shop.example.com")
    await Effect.runPromise(Queue.offer(queue, { type: "session.deleted", data: { sessionID: "ses_event" } } as never))
    // The subscription is forked; give it a bounded moment to drain.
    for (let attempt = 0; attempt < 50 && grantsFor("ses_event").size > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(grantsFor("ses_event").size).toBe(0)
  })
})

describe("the diff console read", () => {
  test("does not run unless the plan is already granted for the session", async () => {
    const host = await boot()
    const result = await host.call("browser_click", {})
    expect(state.calls.map((call) => call.name)).toEqual(["browser_click"])
    expect(textOf(result)).not.toContain("Console errors")
  })

  test("runs with the session's own authorized list, so the frame filter sees the same grants", async () => {
    const host = await boot()
    const backend = await browser()
    const seen: { name: string; authorized?: readonly string[] }[] = []
    const real = backend.callTool.bind(backend)
    backend.callTool = async (name, args, ctx) => {
      seen.push({ name, authorized: ctx.authorized })
      return real(name, args, ctx)
    }
    // A read grant exists before the diff read, so the console call is allowed to run.
    await host.call("browser_find", { query: "Go" }, "ses_authorized")
    await host.call("browser_click", {}, "ses_authorized")
    const console = seen.filter((call) => call.name === "browser_console_messages")
    expect(console.length).toBeGreaterThan(0)
    expect(console.at(-1)?.authorized ?? []).toContain("read:https://gate.example.com")
  })
})

describe("shutdown", () => {
  test("clears the snapshot tracker, so a restarted location starts fresh", async () => {
    const first = await boot()
    await first.call("browser_click", {}, "ses_clear")
    await first.close()
    const second = await boot()
    const result = await second.call("browser_click", {}, "ses_clear")
    await second.close()
    // Without the clear, the identical page would be reported as an unchanged diff against the old snapshot.
    expect(textOf(result)).toContain("### Snapshot")
    expect(textOf(result)).not.toContain("Page changes")
  })
})
