import { Effect, Option, Schema } from "effect"
import z from "zod"
import * as Log from "@opencode-ai/core/util/log"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InvalidArgumentsError, Tool } from "@/tool/tool"
import type { Backend, CallResult } from "./backend"
import { UnavailableError } from "./backend"
import { BrowserContract } from "./contract"
import type { Entry } from "./contract-shape"
import { BrowserEvents } from "./events"
import { extensionBackend } from "./extension"
import { Tracker, observe, snapshot, split } from "./observation"
import { playwright } from "./playwright"
import { resolve } from "./settings"
import type { Settings } from "./settings"

const log = Log.create({ service: "browser.tools" })

const tracker = new Tracker()

const Args = z.record(z.string(), z.unknown())

type Deps = {
  config: Config.Interface
  bus: Option.Option<Bus.Interface>
}

function textOf(result: CallResult) {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n")
}

function backend(browser: Settings): Promise<Backend> {
  if (browser.backend === "extension") return Promise.resolve(extensionBackend)
  return playwright(browser)
}

function announce(error: UnavailableError, browser: Settings, bus: Option.Option<Bus.Interface>) {
  return Effect.gen(function* () {
    log.warn("browser unavailable", { backend: browser.backend, hint: error.hint })
    if (Option.isNone(bus)) return
    yield* bus.value.publish(BrowserEvents.Unavailable, {
      backend: browser.backend === "extension" ? "extension" : "playwright",
      reason: error.message,
      hint: error.hint,
    })
  })
}

function run(entry: Entry, args: unknown, ctx: Tool.Context, deps: Deps) {
  return Effect.gen(function* () {
    const browser = resolve(yield* deps.config.get())
    if (browser.backend === "off")
      return yield* Effect.die(new UnavailableError("Set browser.backend to playwright in the Kilo config."))
    const parsed = Args.safeParse(args ?? {})
    if (!parsed.success) return yield* Effect.die(new InvalidArgumentsError({ tool: entry.name, detail: "not an object" }))

    const active = yield* Effect.tryPromise({ try: () => backend(browser), catch: (error) => error }).pipe(
      Effect.catch((error) =>
        error instanceof UnavailableError
          ? announce(error, browser, deps.bus).pipe(Effect.andThen(Effect.die(error)))
          : Effect.die(error),
      ),
    )

    const result = yield* Effect.promise(() =>
      active.call(entry.name, parsed.data, { session: ctx.sessionID }),
    )

    const text = textOf(result)
    const next = snapshot(split(text))
    // An explicit snapshot request is answered in full; diff mode is for the state after an action.
    const mode = browser.observation === "diff" && entry.name === "browser_snapshot" ? "full" : browser.observation
    const consoleErrors =
      mode === "diff"
        ? yield* Effect.promise(() =>
            active
              .call("browser_console_messages", { level: "error" }, { session: ctx.sessionID })
              .then((console) => tracker.consoleErrors(ctx.sessionID, textOf(console))),
          ).pipe(Effect.catch(() => Effect.succeed<string[]>([])))
        : []
    const previous = mode === "diff" ? tracker.previous(ctx.sessionID, entry.name, next?.url) : undefined
    const viewed = observe({ mode, text, previous, consoleErrors })
    if (viewed.snapshot) tracker.record(ctx.sessionID, viewed.snapshot)

    const attachments: { type: "file"; mime: string; url: string; filename: string }[] = []
    for (const block of result.content) {
      if (block.type !== "image") continue
      const ext = block.mimeType.split("/")[1] || "png"
      attachments.push({
        type: "file",
        mime: block.mimeType,
        url: `data:${block.mimeType};base64,${block.data}`,
        filename: `browser-${entry.name}.${ext}`,
      })
    }

    return {
      title: entry.title || entry.name,
      metadata: {
        browser: {
          backend: browser.backend,
          observation: browser.observation,
          ...(next?.url ? { url: next.url } : {}),
          ...(next?.title ? { title: next.title } : {}),
        },
      },
      output: viewed.text,
      attachments,
    }
  }).pipe(Effect.orDie)
}

/** Every browser tool of the pinned Playwright MCP contract, as a Kilo builtin tool. */
export const infos = Effect.all(
  BrowserContract.entries.map((entry) =>
    Tool.define(
      entry.name,
      Effect.gen(function* () {
        const config = yield* Config.Service
        const bus = yield* Effect.serviceOption(Bus.Service)
        return {
          description: entry.description,
          parameters: Schema.Unknown,
          jsonSchema: entry.inputSchema,
          execute: (args: unknown, ctx: Tool.Context) => run(entry, args, ctx, { config, bus }),
        }
      }),
    ),
  ),
)
