import { Effect, Either, Option, Schema } from "effect"
import z from "zod"
import * as Log from "@opencode-ai/core/util/log"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InvalidArgumentsError, Tool } from "@/tool/tool"
import type { Backend, CallContext, CallResult } from "./backend"
import { NeedsPermissionError, UnavailableError } from "./backend"
import { BrowserContract } from "./contract"
import type { Entry } from "./contract-shape"
import { BrowserEvents } from "./events"
import { extensionBackend } from "./extension"
import { Tracker, observe, snapshot, split } from "./observation"
import { BrowserPermission } from "./permission"
import type { Item } from "./permission"
import { BrowserPolicy } from "./policy"
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

/**
 * Per-session grants: every `<class>:<origin>` pair this session approved, whether a
 * person replied or a config rule allowed it without a prompt. Bounded so a long-lived
 * process does not accumulate sessions that ended.
 */
const GRANTS = new Map<string, Set<string>>()
const GRANT_LIMIT = 200

function grantsFor(session: string) {
  const existing = GRANTS.get(session)
  if (existing) return existing
  while (GRANTS.size >= GRANT_LIMIT) {
    const oldest = GRANTS.keys().next().value
    if (oldest === undefined) break
    GRANTS.delete(oldest)
  }
  const created = new Set<string>()
  GRANTS.set(session, created)
  return created
}

/** Ask for the items this session has not approved yet. Config rules answer without a prompt. */
function authorize(
  items: readonly Item[],
  ctx: Tool.Context,
  allowSensitive: boolean,
  allowed: (origin: string) => boolean,
) {
  return Effect.gen(function* () {
    const grants = grantsFor(ctx.sessionID)
    for (const item of BrowserPermission.unique(items)) {
      const pattern = BrowserPermission.pattern(item)
      if (item.class !== "sensitive" && grants.has(pattern)) continue
      // The organization allowlist grants every class on an origin without a prompt.
      if (item.class !== "sensitive" && allowed(item.origin)) {
        grants.add(pattern)
        continue
      }
      yield* ctx.ask(BrowserPermission.request(item, allowSensitive))
      // A sensitive step is approved per step through its token, never remembered here.
      if (item.class !== "sensitive") grants.add(pattern)
    }
  })
}

/** The (class, origin) items a call needs, planned by a backend that can inspect the page. */
function planned(active: Backend, entry: Entry, args: Record<string, unknown>, ctx: Tool.Context) {
  if (!active.plan) return Effect.succeed<Item[]>([])
  const context: CallContext = { session: ctx.sessionID, authorized: [...grantsFor(ctx.sessionID)], sensitive: [] }
  return Effect.tryPromise({ try: () => active.plan!(entry.name, args, context), catch: (error) => error }).pipe(
    Effect.orDie,
  )
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
    const settings = resolve(yield* deps.config.get())
    // Organization policy: off hides browser tools, playwright_only pins the bundled backend.
    const policy = yield* BrowserPolicy.get()
    const browser = policy?.control === "playwright_only" ? { ...settings, backend: "playwright" as const } : settings
    if (browser.backend === "off" || policy?.control === "off")
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

    // Ask, then call. A backend that discovers the real origin at action time (redirects,
    // frames, sensitive elements, downloads) reports it as needs_permission; the call is
    // retried once with the new grants and the step token.
    let sensitive: string[] = []
    let outcome: Either.Either<CallResult, unknown> | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      yield* authorize(
        yield* planned(active, entry, parsed.data, ctx),
        ctx,
        browser.allowSensitive,
        (origin) => BrowserPolicy.allows(policy, origin),
      )
      const call: CallContext = { session: ctx.sessionID, authorized: [...grantsFor(ctx.sessionID)], sensitive }
      outcome = yield* Effect.either(
        Effect.tryPromise({ try: () => active.call(entry.name, parsed.data, call), catch: (error) => error }),
      )
      if (Either.isRight(outcome)) break
      const error = outcome.left
      if (!(error instanceof NeedsPermissionError)) return yield* Effect.die(error)
      if (attempt === 1 || !error.items.length) {
        return {
          title: entry.title || entry.name,
          metadata: { browser: { backend: browser.backend, observation: browser.observation } },
          output: "The browser page changed while permission was requested. Call the tool again.",
          attachments: [],
        }
      }
      yield* authorize(error.items, ctx, browser.allowSensitive, (origin) => BrowserPolicy.allows(policy, origin))
      sensitive = error.stepToken ? [error.stepToken] : []
    }
    if (!outcome || Either.isLeft(outcome)) return yield* Effect.die(new Error("browser call did not settle"))
    const result = outcome.right

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
