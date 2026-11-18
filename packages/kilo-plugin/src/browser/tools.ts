import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Permission } from "@opencode/core/permission"
import { Wildcard } from "@opencode/core/util/wildcard"
import { KiloBrowserPolicy } from "@kilocode/gateway-core/browser-policy"
import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Effect, Option, Result, Stream } from "effect"
import type { JsonSchema } from "effect"
import {
  NeedsPermissionError,
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
import { BrowserPermission } from "./permission"
import { key, playwright } from "./playwright"
import { resolve, type Settings } from "./settings"
import { KiloGatewayAccounts } from "../gateway/accounts"

type Item = BrowserPermission.Item

const tracker = new Tracker()

/** The hint the UI shows for the extension backend until the browser hub is wired (part C). */
const EXTENSION_HINT =
  'Install the Kilo browser extension, turn on "Allow local agents", then set browser.backend to "extension".'

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

/** How long an organization policy is reused before the cloud is asked again. */
const POLICY_TTL = 60_000
const policies = new Map<string, { value: KiloBrowserPolicy.Policy | undefined; expires: number }>()

/**
 * The active organization's browser policy, read with the Gateway account of the location. A missing account, a
 * personal account or an unreachable API is no policy, never an error.
 */
function policy(directory: string, endpoint?: string) {
  const account = KiloGatewayAccounts.get(directory)
  const id = account?.organizationID ?? undefined
  if (!account || !id) return Effect.succeed<KiloBrowserPolicy.Policy | undefined>(undefined)
  const cached = policies.get(id)
  if (cached && cached.expires > Date.now()) return Effect.succeed(cached.value)
  return KiloBrowserPolicy.get({
    server: account.baseURL,
    token: account.token,
    organizationID: id,
    ...(endpoint ? { endpoint } : { endpoint: account.baseURL }),
  }).pipe(
    Effect.map((value) => {
      policies.set(id, { value, expires: Date.now() + POLICY_TTL })
      return value
    }),
  )
}

/**
 * Per-session grants: every `<class>:<origin>` pair this session approved, whether a person replied or a config rule
 * allowed it without a prompt. Bounded so a long-lived process does not accumulate sessions that ended.
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

function textOf(result: CallResult) {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n\n")
}

/**
 * Model-facing failures: a tool error the model can act on, never a transport state. An unavailable backend keeps its
 * setup hint out of the message and logs it for the UI.
 */
function failure(error: unknown) {
  // Already model-facing: a mapped failure keeps its metadata instead of being wrapped again.
  if (error instanceof Tool.Error) return error
  if (error instanceof UnsupportedError) return new Tool.Error({ message: UNSUPPORTED_MESSAGE })
  if (error instanceof UnavailableError) {
    return new Tool.Error({ message: UNAVAILABLE_MESSAGE, metadata: { hint: error.hint } })
  }
  return new Tool.Error({ message: error instanceof Error ? error.message : String(error) })
}

/** Read the config per call, so an observation or headless change applies without a restart. */
function settings(config: Option.Option<Config.Interface>) {
  if (Option.isNone(config)) return Effect.succeed(resolve(undefined))
  return config.value.entries().pipe(Effect.map((entries) => resolve(KiloConfigPolicy.browserConfig(entries))))
}

/** A rule that names the browser permission itself decides the class, so the built-in defaults stay out of its way. */
function decided(resource: string, rules: Permission.Ruleset) {
  return rules.some(
    (rule) =>
      rule.action !== "*" &&
      Wildcard.match(BrowserPermission.permission, rule.action) &&
      Wildcard.match(resource, rule.resource),
  )
}

/**
 * The built-in browser defaults, as the evaluate hook applies them: a class grant on the localhost family is allowed,
 * every other origin asks, and a sensitive step always needs a person unless `browser.allow_sensitive` is on.
 */
type EffectValue = "allow" | "deny" | "ask"

export function evaluate(input: {
  action: string
  effect: EffectValue
  resources: readonly string[]
  rules: Permission.Ruleset
  allowSensitive: boolean
}): { effect: EffectValue; message?: string } {
  if (input.effect !== "allow") return { effect: input.effect }
  if (input.action === BrowserPermission.sensitive) {
    if (input.allowSensitive) return { effect: "allow" }
    return { effect: "ask", message: "A sensitive browser step needs a person to approve it." }
  }
  if (input.action !== BrowserPermission.permission) return { effect: "allow" }
  const built = input.resources.every((resource) => {
    if (decided(resource, input.rules)) return true
    const item = BrowserPermission.parse(resource)
    return item !== undefined && BrowserPermission.defaultGrant(item)
  })
  if (built) return { effect: "allow" }
  return { effect: "ask", message: "Browser access to this origin needs approval." }
}

/** Ask for the items this session has not approved yet. Config rules answer without a prompt. */
export function authorize(
  items: readonly Item[],
  context: Tool.Context,
  allowSensitive: boolean,
  allowed: (origin: string) => boolean,
  permission: Option.Option<Permission.Interface>,
) {
  return Effect.gen(function* () {
    const grants = grantsFor(String(context.sessionID))
    for (const item of BrowserPermission.unique(items)) {
      const pattern = BrowserPermission.pattern(item)
      if (item.class !== "sensitive" && grants.has(pattern)) continue
      // The organization allowlist grants every class on an origin without a prompt.
      if (item.class !== "sensitive" && allowed(item.origin)) {
        grants.add(pattern)
        continue
      }
      const request = BrowserPermission.request(item, allowSensitive)
      if (Option.isSome(permission)) yield* permission.value.assert({ ...request, ...Permission.invocation(context) })
      // A sensitive step is approved per step through its token, never remembered here.
      if (item.class !== "sensitive") grants.add(pattern)
    }
  })
}

/**
 * Console data for diff mode. The internal call is a real read: it plans like a user call, and it returns nothing
 * unless every item the plan asks for is already granted for this session. It then runs with the same authorized
 * list, so the frame filter sees the same grants a user call does.
 */
/**
 * What the model reads when the grant a withheld result asked for was refused. Plain and specific: the action
 * happened, the page is somewhere else now, and only reading it is blocked - so the model must not repeat the action.
 */
export function withheldRefusal(origin: string): string {
  return [
    `Note: the action ran. The page is now on ${origin}, and reading it needs the user's permission, which was not granted.`,
    "Do not repeat the action; ask the user to approve reading that origin, then read the page.",
  ].join("\n")
}

function consoleErrors(active: BrowserBackend, session: string, context: Tool.Context) {
  return Effect.gen(function* () {
    if (!active.plan) return []
    const grants = grantsFor(session)
    const planned = yield* Effect.tryPromise({
      try: () =>
        active.plan!(
          "browser_console_messages",
          { level: "error" },
          {
            session,
            authorized: [...grants],
          },
        ),
      catch: () => [],
    })
    if (planned.some((item) => !grants.has(BrowserPermission.pattern(item)))) return []
    const result = yield* Effect.tryPromise({
      try: (signal) =>
        active.callTool("browser_console_messages", { level: "error" }, { signal, session, authorized: [...grants] }),
      catch: (error) => error,
    })
    return tracker.consoleErrors(session, textOf(result))
  }).pipe(Effect.catch(() => Effect.succeed<string[]>([])))
}

type Deps = {
  config: Option.Option<Config.Interface>
  permission: Option.Option<Permission.Interface>
  directory: string
}

function run(entry: Entry, args: unknown, context: Tool.Context, deps: Deps) {
  return Effect.gen(function* () {
    const browser = yield* settings(deps.config)
    // The tools are not registered while the backend is off; a config edit during the session still refuses.
    if (browser.backend === "off") return yield* failure(new UnavailableError("Set browser.backend to playwright."))

    const organization = yield* policy(deps.directory)
    if (organization?.control === "off")
      return yield* failure(new UnavailableError("Your organization turned off browser control in Kilo."))
    const choice: Settings =
      organization?.control === "playwright_only" ? { ...browser, backend: "playwright" } : browser

    // The tool's own key first, so a config rule like `browser_click: deny` blocks it before anything runs.
    if (Option.isSome(deps.permission)) {
      yield* deps.permission.value.assert({
        action: entry.name,
        resources: ["*"],
        save: [],
        metadata: { tool: entry.name },
        ...Permission.invocation(context),
      })
    }

    // The effect's interruption signal reaches the MCP call, so cancelling the turn aborts the browser action.
    const active = yield* Effect.tryPromise({
      try: () => (choice.backend === "extension" ? Promise.resolve(extension) : playwright.get(key(choice))),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.andThen(Effect.logWarning("browser unavailable", { reason: String(error) }), Effect.fail(error)),
      ),
    )
    const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}
    const session = String(context.sessionID)
    const grants = grantsFor(session)
    const allowSensitive = browser.allowSensitive

    // Ask, then call. A backend that discovers the real origin at action time (redirects, frames, sensitive elements,
    // downloads) reports it as needs_permission; the call is retried once with the new grants and the step token.
    let sensitive: string[] = []
    let result: CallResult | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      if (active.plan) {
        const planned = yield* Effect.tryPromise({
          try: () => active.plan!(entry.name, input, { session, authorized: [...grants], sensitive: [...sensitive] }),
          catch: (error) => error,
        }).pipe(Effect.catch(() => Effect.succeed<readonly Item[]>([])))
        yield* authorize(
          planned,
          context,
          allowSensitive,
          (origin) => KiloBrowserPolicy.allows(organization, origin),
          deps.permission,
        )
      }
      const outcome = yield* Effect.result(
        Effect.tryPromise({
          try: (signal) =>
            active.callTool(entry.name, input, {
              signal,
              session,
              authorized: [...grants],
              sensitive: [...sensitive],
            }),
          catch: (error) => error,
        }),
      )
      if (Result.isSuccess(outcome)) {
        result = outcome.success
        break
      }
      const error = outcome.failure
      if (!(error instanceof NeedsPermissionError)) return yield* failure(error)
      if (attempt === 1 || !error.items.length) {
        return yield* failure(
          new Error("The browser page changed while permission was requested. Call the tool again."),
        )
      }
      yield* authorize(
        error.items,
        context,
        allowSensitive,
        (origin) => KiloBrowserPolicy.allows(organization, origin),
        deps.permission,
      )
      sensitive = error.stepToken ? [error.stepToken] : []
    }
    if (!result) return yield* failure(new Error("the browser call did not settle"))
    if (result.isError) return yield* failure(new Error(textOf(result) || `${entry.name} failed`))
    // The action already ran; its result asked for a grant. Ask now, and never repeat the action for it.
    const needs = result.meta?.needs
    if (needs?.length) {
      const asked = yield* Effect.result(
        authorize(
          needs,
          context,
          allowSensitive,
          (origin) => KiloBrowserPolicy.allows(organization, origin),
          deps.permission,
        ),
      )
      // Granted: read the page again rather than return the withheld placeholder. Reading has no side effect, so the
      // action still happened once.
      if (Result.isSuccess(asked)) {
        const reread = yield* Effect.result(
          Effect.tryPromise({
            try: (signal) => active.callTool("browser_snapshot", {}, { signal, session, authorized: [...grants] }),
            catch: (error) => error,
          }),
        )
        if (Result.isSuccess(reread) && !reread.success.isError) {
          result.content = reread.success.content
          result.meta = reread.success.meta
        }
      }
      // A refusal must never read as the action being rejected: the action ran, only its content stayed unread.
      if (Result.isFailure(asked)) {
        const origin = needs[0]?.origin ?? ""
        return {
          content: [{ type: "text", text: `${textOf(result)}\n\n${withheldRefusal(origin)}` }],
          metadata: {
            browser: {
              backend: choice.backend,
              observation: browser.observation,
              ...(origin ? { url: origin } : {}),
              ...(result.meta?.withheldFrames ? { withheldFrames: result.meta.withheldFrames } : {}),
            },
          },
        } as Tool.Result
      }
    }

    const text = textOf(result)
    const next = snapshot(split(text))
    const mode = modeFor(entry.name, browser.observation)
    const errors = mode === "diff" ? yield* consoleErrors(active, session, context) : []
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
          backend: choice.backend,
          observation: browser.observation,
          ...(next?.url ? { url: next.url } : {}),
          ...(next?.title ? { title: next.title } : {}),
          ...(result.meta?.withheldFrames ? { withheldFrames: result.meta.withheldFrames } : {}),
        },
      },
    } as Tool.Result
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
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        tracker.clear()
        await playwright.dispose()
      }),
    )

    // A deleted session releases its remembered page at once. The stream never ends, so it is forked: awaiting it
    // here would keep the plugin effect from ever registering its tools.
    yield* ctx.event.subscribe({ types: ["session.deleted"] }).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.type !== "session.deleted") return
          tracker.forget(event.data.sessionID)
          playwright.forgetSession(event.data.sessionID)
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    const config = yield* Effect.serviceOption(Config.Service)
    const permission = yield* Effect.serviceOption(Permission.Service)
    // Built-in defaults and the sensitive gate, applied to every browser permission request.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        if (event.action !== BrowserPermission.permission && event.action !== BrowserPermission.sensitive) return
        const browser = yield* settings(config)
        const evaluated = evaluate({
          action: event.action,
          effect: event.effect,
          resources: event.resources,
          rules: event.rules ?? [],
          allowSensitive: browser.allowSensitive,
        })
        event.effect = evaluated.effect
        if (evaluated.message !== undefined) event.message = evaluated.message
      }),
    )

    const browser = yield* settings(config)
    const organization = yield* policy(ctx.location.directory)
    // `off` hides the tools: an agent never sees a browser tool it cannot use.
    if (browser.backend === "off" || organization?.control === "off") return

    yield* ctx.tool.transform((editor) => {
      for (const entry of BrowserContract.entries) {
        editor.add({
          name: entry.name,
          options: { codemode: false },
          description: entry.description,
          input: entry.inputSchema as JsonSchema.JsonSchema,
          execute: (args: unknown, context: Tool.Context) =>
            run(entry, args, context, { config, permission, directory: ctx.location.directory }),
        })
      }
    })
  }),
})
