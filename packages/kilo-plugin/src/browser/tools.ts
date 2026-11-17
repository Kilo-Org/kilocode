import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Effect, Option } from "effect"
import type { JsonSchema } from "effect"
import {
  UNAVAILABLE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  UnavailableError,
  UnsupportedError,
  type BrowserBackend,
  type CallResult,
} from "./backend"
import { BrowserContract } from "./contract"
import type { Entry } from "./contract-shape"
import { modeFor, observe, snapshot, split, Tracker } from "./observation"
import { key, playwright } from "./playwright"
import { resolve } from "./settings"

const tracker = new Tracker()

/** The hint the UI shows for the extension backend until the browser hub is wired (part C). */
const EXTENSION_HINT =
  "Install the Kilo browser extension, turn on \"Allow local agents\", then set browser.backend to \"extension\"."

/**
 * The extension backend. The hub, the pairing and the transport are part C; until then the tools exist so the tool
 * list is the same on every backend and every call reports the browser as unavailable, with a setup hint for the UI.
 */
const extension: BrowserBackend = {
  id: "extension",
  contractSha: BrowserContract.sha256,
  listTools: async () => BrowserContract.entries,
  callTool: async () => {
    throw new UnavailableError(EXTENSION_HINT)
  },
  dispose: async () => {},
}

function textOf(result: CallResult) {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n")
}

/**
 * Model-facing failures: a tool error the model can act on, never a transport state. An unavailable backend keeps its
 * setup hint out of the message and logs it for the UI.
 */
function failure(error: unknown) {
  if (error instanceof UnsupportedError) return new Tool.Error({ message: UNSUPPORTED_MESSAGE })
  if (error instanceof UnavailableError) {
    return new Tool.Error({ message: UNAVAILABLE_MESSAGE, metadata: { hint: error.hint } })
  }
  return new Tool.Error({ message: error instanceof Error ? error.message : String(error) })
}

/** Read the config per call, so an observation or headless change applies without a restart. */
function settings(config: Option.Option<Config.Interface>) {
  if (Option.isNone(config)) return Effect.succeed(resolve(undefined))
  return config.value
    .entries()
    .pipe(Effect.map((entries) => resolve(KiloConfigPolicy.browserConfig(entries))))
}

/**
 * New console errors since the previous call of this session, for diff mode. A failure to read them is not a failure
 * of the action that just ran.
 */
function consoleErrors(active: BrowserBackend, session: string) {
  return Effect.tryPromise({
    try: (signal) => active.callTool("browser_console_messages", { level: "error" }, { signal }),
    catch: (error) => error,
  }).pipe(
    Effect.map((console) => tracker.consoleErrors(session, textOf(console))),
    Effect.catch(() => Effect.succeed<string[]>([])),
  )
}

function run(entry: Entry, args: unknown, context: Tool.Context, config: Option.Option<Config.Interface>) {
  return Effect.gen(function* () {
    const browser = yield* settings(config)
    // The tools are not registered while the backend is off; a config edit during the session still refuses.
    if (browser.backend === "off") return yield* failure(new UnavailableError("Set browser.backend to playwright."))

    const active = yield* Effect.tryPromise({
      try: () => (browser.backend === "extension" ? Promise.resolve(extension) : playwright.get(key(browser))),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.andThen(Effect.logWarning("browser unavailable", { reason: String(error) }), Effect.fail(error)),
      ),
    )
    const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}
    // The effect's interruption signal reaches the MCP call, so cancelling the turn aborts the browser action.
    const result = yield* Effect.tryPromise({
      try: (signal) => active.callTool(entry.name, input, { signal, authorized: [], sensitive: [] }),
      catch: (error) => error,
    })
    const text = textOf(result)
    if (result.isError) return yield* failure(new Error(text || `${entry.name} failed`))

    const session = String(context.sessionID)
    const next = snapshot(split(text))
    const mode = modeFor(entry.name, browser.observation)
    const errors = mode === "diff" ? yield* consoleErrors(active, session) : []
    const previous = mode === "diff" ? tracker.previous(session, entry.name, next?.url) : undefined
    const viewed = observe({ mode, text, previous, consoleErrors: errors })
    if (viewed.snapshot) tracker.record(session, viewed.snapshot)

    const content: Tool.Content[] = [{ type: "text", text: viewed.text }]
    for (const block of result.content) {
      if (block.type !== "image") continue
      const ext = block.mimeType.split("/")[1] || "png"
      content.push({
        type: "file",
        uri: `data:${block.mimeType};base64,${block.data}`,
        mime: block.mimeType,
        name: `browser-${entry.name}.${ext}`,
      })
    }

    return {
      content,
      metadata: {
        browser: {
          backend: browser.backend,
          observation: browser.observation,
          ...(next?.url ? { url: next.url } : {}),
          ...(next?.title ? { title: next.title } : {}),
        },
      },
    }
  }).pipe(Effect.mapError((error) => failure(error)))
}

/**
 * Every browser tool of the pinned Playwright MCP contract, registered once per location. The input schema is the
 * contract's own JSON Schema, so the model sees the upstream tool definition unchanged on every backend.
 */
export const KiloBrowserToolsPlugin = define({
  id: "kilocode.browser-tools",
  effect: Effect.fn("KiloBrowserToolsPlugin")(function* (ctx) {
    // The bundled browser lives as long as this location: the finalizer runs when the server shuts down.
    yield* Effect.addFinalizer(() => Effect.promise(() => playwright.dispose()))

    const config = yield* Effect.serviceOption(Config.Service)
    const browser = yield* settings(config)
    // `off` hides the tools: an agent never sees a browser tool it cannot use.
    if (browser.backend === "off") return

    yield* ctx.tool.transform((editor) => {
      for (const entry of BrowserContract.entries) {
        editor.add({
          name: entry.name,
          options: { codemode: false },
          description: entry.description,
          input: entry.inputSchema as JsonSchema.JsonSchema,
          execute: (args: unknown, context: Tool.Context) => run(entry, args, context, config),
        })
      }
    })
  }),
})
