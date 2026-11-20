import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Permission } from "@opencode/core/permission"
import { Wildcard } from "@opencode/core/util/wildcard"
import { isFallbackTitle } from "@opencode/util/session-title-fallback"
import { KiloBrowserPolicy } from "@kilocode/gateway-core/browser-policy"
import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { KiloBrowserRpc } from "@opencode/schema/kilocode/browser"
import type { SessionID } from "@opencode/schema/session-id"
import { Effect, Option, Result, Schema, Scope, Stream } from "effect"
import type { JsonSchema } from "effect"
import {
  CancelledError,
  IncompatibleError,
  NeedsPermissionError,
  PageMovedError,
  TimeoutError,
  UNAVAILABLE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  StoppedError,
  UnavailableError,
  UnsupportedError,
  type BrowserBackend,
  type CallResult,
} from "./backend"
import { BrowserContract } from "./contract"
import GUIDE from "./browser-skill.txt"
import type { Entry } from "./contract-shape"
import type { ExtensionBackend } from "./extension"
import { BrowserHub } from "./hub"
import { modeFor, observe, snapshot, split, Tracker, type Tab } from "./observation"
import { BrowserPermission } from "./permission"
import { key, persistStep, playwright, readiness } from "./playwright"
import { resolve, type Observation, type Settings } from "./settings"
import { hashArguments, rememberHash, rememberStep } from "./steps"
import { KiloGatewayAccounts } from "../gateway/accounts"

type Item = BrowserPermission.Item

const tracker = new Tracker()

/** The policy cache key: one gateway answering for another's organization is not the same policy. */
export function policyKey(server: string, organizationID: string) {
  return `${server}:${organizationID}`
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
  const key = policyKey(account.baseURL, id)
  const cached = policies.get(key)
  if (cached && cached.expires > Date.now()) return Effect.succeed(cached.value)
  return KiloBrowserPolicy.get({
    server: account.baseURL,
    token: account.token,
    organizationID: id,
    ...(endpoint ? { endpoint } : { endpoint: account.baseURL }),
  }).pipe(
    Effect.map((value) => {
      policies.set(key, { value, expires: Date.now() + POLICY_TTL })
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

export function grantsFor(session: string) {
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

const decodeOpened = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ url: Schema.String })))

/**
 * The page a result shows: the browser's own report, the Playwright-style `Page URL` line, or the `{ title, url }`
 * answer the extension gives for a navigation.
 */
function pageUrl(result: CallResult) {
  const text = textOf(result)
  return (
    result.meta?.url ??
    snapshot(split(text))?.url ??
    Option.getOrUndefined(Option.map(decodeOpened(text), (opened) => opened.url))
  )
}

/**
 * Where a successful call left the session's tab: the page its result names; closed after `browser_close`; unknown
 * after a tab switch, open or close whose result names no page; unchanged (undefined) for any other call.
 */
function placed(tool: string, args: Record<string, unknown>, result: CallResult): Tab | undefined {
  const url = pageUrl(result)
  if (url) return { kind: "page", url }
  if (tool === "browser_close") return { kind: "closed" }
  if (tool === "browser_tabs" && args.action !== "list") return { kind: "unknown" }
  return undefined
}

/**
 * Where a failed call left the session's tab: on the origin a redirect reached, unknown after a move to a page the
 * browser did not name, unchanged (undefined) for any other failure.
 */
function movedTo(error: unknown): Tab | undefined {
  if (error instanceof PageMovedError) return { kind: "unknown" }
  if (error instanceof NeedsPermissionError && error.moved !== undefined) return { kind: "moved", origin: error.moved }
  return undefined
}

/**
 * Model-facing failures: a tool error the model can act on, never a transport state. An unavailable backend keeps its
 * setup step in the message as well as in the metadata: `run --format json` and other non-interactive hosts surface
 * only the message, so the hint would otherwise never reach the user. An inaccessible protocol keeps its update notice
 * in the metadata the UI reads, and a call that may have run carries the marker instead of asserting it did not.
 */
function failure(error: unknown) {
  // Already model-facing: a mapped failure keeps its metadata instead of being wrapped again.
  if (error instanceof Tool.Error) return error
  if (error instanceof UnsupportedError) return new Tool.Error({ message: UNSUPPORTED_MESSAGE })
  if (error instanceof UnavailableError) {
    return new Tool.Error({
      message: error.hint ? `${UNAVAILABLE_MESSAGE} ${error.hint}` : UNAVAILABLE_MESSAGE,
      metadata: { hint: error.hint, ...(error.effectsUncertain ? { effectsUncertain: true } : {}) },
    })
  }
  if (error instanceof TimeoutError) {
    return new Tool.Error({ message: error.message, metadata: { effectsUncertain: true } })
  }
  // A call cancelled in flight may have run in part, so the marker travels with it as it does for a timeout.
  if (error instanceof CancelledError) {
    return new Tool.Error({
      message: error.message,
      ...(error.effectsUncertain ? { metadata: { effectsUncertain: true } } : {}),
    })
  }
  if (error instanceof IncompatibleError) {
    return new Tool.Error({ message: error.message, metadata: { hint: error.hint } })
  }
  return new Tool.Error({ message: error instanceof Error ? error.message : String(error) })
}

/** The UI notice one failed call raises, or undefined when the model's own error text is all the user needs. */
export function notice(sessionID: SessionID, error: unknown): KiloBrowserRpc.Notice | undefined {
  if (error instanceof UnavailableError) return { kind: "unavailable", sessionID, hint: error.hint }
  if (error instanceof IncompatibleError) return { kind: "outdated", sessionID, hint: error.hint }
  if (error instanceof StoppedError) return { kind: "stopped", sessionID }
  return undefined
}

/** A failed `/browser share` or `/browser adopt`: the setup step when no browser answers, else the reason in words. */
export function refusal(error: unknown): { kind: "unavailable"; hint: string } | { kind: "refused"; message: string } {
  if (error instanceof UnavailableError) return { kind: "unavailable", hint: error.hint }
  if (error instanceof IncompatibleError) return { kind: "refused", message: `${error.message} ${error.hint}` }
  return { kind: "refused", message: error instanceof Error ? error.message : String(error) }
}

/**
 * Keep a per-target backend map at most `limit` entries: the least recently used are dropped and disposed, so a
 * session that keeps switching profiles cannot grow it.
 */
export function trim<T extends { dispose(): Promise<void> }>(extensions: Map<string, Promise<T>>, limit: number) {
  while (extensions.size > limit) {
    const oldest = extensions.keys().next().value
    if (oldest === undefined) return
    const evicted = extensions.get(oldest)
    extensions.delete(oldest)
    void evicted?.then((backend) => backend.dispose()).catch(() => undefined)
  }
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

/** What a refusal names: the class on its origin, or a sensitive step on its origin. */
function subject(item: Item) {
  return `${item.class === "sensitive" ? "a sensitive step" : item.class} on ${item.origin}`
}

/** The model-facing text of each way a browser permission can be refused. */
const REFUSAL = {
  declined: (what: string, where: string) =>
    `The user denied ${what}. ${where} Do not retry; ask the user or continue without it.`,
  blocked: (what: string, where: string) =>
    `A permission rule denies ${what}. ${where} Do not retry; continue without it, or ask the user to change the rule.`,
  corrected: (what: string, where: string, feedback: string) =>
    `Permission for ${what} was not granted. ${where} ${feedback}`,
}

/**
 * A plain decline that names what was refused. It stays a `Permission.DeclinedError` defect, so the step still ends
 * the way any decline does; only the text a Code Mode program reads for it changes.
 */
class BrowserDeclinedError extends Permission.DeclinedError {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  override get message() {
    return this.text
  }
}

/**
 * One permission ask whose refusals name what was refused and the next step. A rule's deny and a decline with
 * feedback keep their own error types, so the host treats them as before; a plain decline stays a defect.
 */
function ask(permission: Permission.Interface, request: Permission.AssertInput, what: string) {
  // The page the session's last result showed: the model's next step starts from where the tab really is, not from
  // the page it asked for.
  const where = () => {
    const tab = tracker.tab(String(request.sessionID))
    if (tab === undefined) return "This session has no browser tab yet."
    switch (tab.kind) {
      case "page":
        return `The tab is still on ${tab.url}.`
      case "moved":
        return `The tab is now on a page at ${tab.origin}.`
      case "closed":
        return "The session's browser tab is closed."
      case "unknown":
        return "Take a snapshot to see which page the tab is on."
    }
  }
  return permission.assert(request).pipe(
    Effect.catchTags({
      "Permission.BlockedError": (error) =>
        Effect.fail(
          new Permission.BlockedError({
            rules: error.rules,
            permission: error.permission,
            resources: error.resources,
            reason: REFUSAL.blocked(what, where()),
          }),
        ),
      "Permission.CorrectedError": (error) =>
        Effect.fail(new Permission.CorrectedError({ feedback: REFUSAL.corrected(what, where(), error.feedback) })),
    }),
    Effect.catchDefect((defect) =>
      Effect.die(
        defect instanceof Permission.DeclinedError ? new BrowserDeclinedError(REFUSAL.declined(what, where())) : defect,
      ),
    ),
  )
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
      if (Option.isSome(permission)) {
        yield* ask(permission.value, { ...request, ...Permission.invocation(context) }, subject(item))
      }
      // A sensitive step is approved per step through its token, never remembered here.
      if (item.class !== "sensitive") grants.add(pattern)
    }
  })
}

/** Clear every remembered grant. The test seam for this module-level cache. */
export function resetGrants() {
  GRANTS.clear()
}

/** Release a session's grants when it is deleted. */
export function forgetGrants(session: string) {
  GRANTS.delete(session)
}

/** The note that says the action already ran and only reading its page was refused. */
export function withheldRefusal(origin: string): string {
  return [
    `Note: the action ran. The page is now on ${origin}, and reading it needs the user's permission, which was not granted.`,
    "Do not repeat the action; ask the user to approve reading that origin, then read the page.",
  ].join("\n")
}

/**
 * Console data for diff mode. The internal call is a real read and must never prompt: a backend that can plan is
 * checked first and the read runs only when every item the plan asks for is already granted for this session. A
 * backend that learns the real origin at action time (the extension) cannot plan; it filters by the grants it is
 * given, and a refusal is swallowed, so it never prompts either. Either way the read runs with the session's own
 * authorized list, so the frame filter sees the same grants a user call does.
 */
function consoleErrors(
  active: BrowserBackend,
  session: string,
  context: Tool.Context,
  permission: Option.Option<Permission.Interface>,
) {
  return Effect.gen(function* () {
    // The per-tool rule is the same one a user call obeys: a deny or an ask skips the console section silently.
    if (Option.isSome(permission)) {
      // `Effect.try` covers a permission service that does not implement the query at all.
      const queried = Effect.try({
        try: () =>
          permission.value.allows({
            action: "browser_console_messages",
            resources: ["*"],
            ...Permission.invocation(context),
          } as never),
        catch: () => Effect.succeed(false),
      })
      const permitted = yield* queried.pipe(
        Effect.flatten,
        Effect.orElseSucceed(() => false),
      )
      if (!permitted) return []
    }
    const grants = grantsFor(session)
    const plan = active.plan?.bind(active)
    if (plan) {
      const planned = yield* Effect.tryPromise({
        try: () => plan("browser_console_messages", { level: "error" }, { session, authorized: [...grants] }),
        catch: () => [],
      })
      if (planned.some((item) => !grants.has(BrowserPermission.pattern(item)))) return []
    }
    const result = yield* Effect.tryPromise({
      try: (signal) =>
        active.callTool("browser_console_messages", { level: "error" }, { signal, session, authorized: [...grants] }),
      catch: (error) => error,
    })
    return tracker.consoleErrors(session, textOf(result))
  }).pipe(Effect.catch(() => Effect.succeed<string[]>([])))
}

/**
 * The backend in force, after the organization policy: `off` hides the tools, `playwright_only` pins the bundled
 * browser, and `allow` (or no policy) keeps the config's own choice. The settings status and the call path both read
 * this one answer. The policy can take a backend away but never turn one on: a config set to `off` stays off under a
 * `playwright_only` pin, which is what the call path refuses.
 */
export function effective(browser: Settings, organization: KiloBrowserPolicy.Policy | undefined): Settings["backend"] {
  if (browser.backend === "off") return "off"
  if (organization?.control === "off") return "off"
  if (organization?.control === "playwright_only") return "playwright"
  return browser.backend
}

/** What a call reports once the user turned the browser off: their decision, which the model must not undo. */
const OFF_MESSAGE =
  "The user turned the browser tools off. Do not change browser settings to turn them back on; continue without the browser."

type Deps = {
  config: Option.Option<Config.Interface>
  permission: Option.Option<Permission.Interface>
  directory: string
  /** The backend a call runs on, resolved per call so a config change applies without a restart. */
  backend: (choice: Settings) => Promise<BrowserBackend>
  /** The conversation's generated title, or undefined while it has none. */
  title: (session: Tool.Context["sessionID"]) => Effect.Effect<string | undefined>
  /** Raises the UI notice for a failed call; the model reads only the tool error. */
  notify: (sessionID: SessionID, error: unknown) => Effect.Effect<void>
}

/** A granted post-action need hands the model either the answer or the page it can read now. */
type PostAction = {
  needs: readonly Item[]
  result: CallResult
  active: BrowserBackend
  entry: Entry
  input: Record<string, unknown>
  session: string
  grants: Set<string>
  allowSensitive: boolean
  observation: Observation
  backend: Settings["backend"]
  context: Tool.Context
  permission: Option.Option<Permission.Interface>
  organization: KiloBrowserPolicy.Policy | undefined
}

/**
 * The grants a result asked for after its action ran: ask for them, remember what the next identical step needs, and
 * answer with the page when the grants were read-only. The action itself is never repeated.
 */
function postAction(input: PostAction) {
  return Effect.gen(function* () {
    // The action ran, so the tab is on the page it reported, whatever the answer to the ask.
    tracker.place(input.session, placed(input.entry.name, input.input, input.result))
    const asked = yield* Effect.result(
      authorize(
        input.needs,
        input.context,
        input.allowSensitive,
        (origin) => KiloBrowserPolicy.allows(input.organization, origin),
        input.permission,
      ),
    )
    if (Result.isFailure(asked)) {
      const origin = input.needs[0]?.origin ?? ""
      return {
        kind: "result" as const,
        result: {
          content: [{ type: "text", text: `${textOf(input.result)}\n\n${withheldRefusal(origin)}` }],
          metadata: {
            browser: {
              backend: input.backend,
              observation: input.observation,
              ...(origin ? { url: origin } : {}),
              ...(input.result.meta?.withheldFrames ? { withheldFrames: input.result.meta.withheldFrames } : {}),
            },
          },
        } as Tool.Result,
      }
    }
    // Granted: the step is approved for the next identical call in this session, so the model can repeat it.
    for (const item of input.needs) {
      if (item.class === "sensitive" && item.reason?.startsWith("download:")) {
        persistStep(input.session, input.entry.name, input.input, item.origin)
      }
    }
    // A browser that issues a step token (the extension) spends it on the step the token was issued for. A late
    // report arrives on whichever call the model made next, so the browser names the causing step when it can; an
    // older extension names none and the carrying call is used, as before.
    const causing = caused(input)
    if (input.result.meta?.stepToken !== undefined) {
      if (causing.late) rememberHash(input.session, causing.tool, causing.hash, input.result.meta.stepToken)
      else rememberStep(input.session, input.entry.name, input.input, input.result.meta.stepToken)
    }
    if (input.needs.some((item) => item.class === "sensitive")) {
      return {
        kind: "result" as const,
        result: {
          content: [
            {
              type: "text",
              text: `${textOf(input.result)}\n\n${
                causing.late
                  ? "Approved. Repeat that step to receive the file."
                  : "Approved. Repeat the same step to receive the file."
              }`,
            },
          ],
          metadata: { browser: { backend: input.backend, observation: input.observation } },
        } as Tool.Result,
      }
    }
    // Only a read need may read the page again. An act or navigate need is the model's own next step to take: the
    // answer keeps the notice and the URL, and says so plainly, because the observation mode may not keep them.
    if (!input.needs.every((item) => item.class === "read")) return granted(input)
    const reread = yield* Effect.result(
      Effect.tryPromise({
        try: (signal) =>
          input.active.callTool(
            "browser_snapshot",
            {},
            { signal, session: input.session, authorized: [...input.grants] },
          ),
        catch: (error) => error,
      }),
    )
    if (Result.isSuccess(reread) && !reread.success.isError) {
      input.result.content = reread.success.content
      input.result.meta = reread.success.meta
    }
    return { kind: "continue" as const, result: input.result }
  })
}

/**
 * The step a granted need belongs to. A late report (a download that started after the click returned) names its
 * causing step, so the token must be remembered under that step, not under the call that carried the news; without
 * one, the carrying call is the step, exactly as before.
 */
function caused(input: PostAction) {
  const step = input.result.meta?.step
  const carrying = hashArguments(input.input)
  return {
    late: step !== undefined && (step.tool !== input.entry.name || step.argumentsHash !== carrying),
    tool: step?.tool ?? input.entry.name,
    hash: step?.argumentsHash ?? carrying,
  }
}

/**
 * A granted need that still needs the model: an act or navigate grant is the model's own next step, and whether the
 * step already ran decides the wording. `afterAction` means the browser did it and withheld the content, so repeating
 * it would run the action twice; a need without it never ran, so the step is repeated.
 */
export function granted(input: PostAction) {
  const ran = input.result.meta?.afterAction === true
  const origin = input.needs[0]?.origin ?? ""
  const url = input.result.meta?.url ?? origin
  return {
    kind: "result" as const,
    result: {
      content: [
        {
          type: "text",
          text: `${textOf(input.result)}\n\n${
            ran
              ? "The step ran. The permission is granted; read the page again (browser_snapshot) to see the result."
              : "Approved. Repeat the same step to perform it."
          }`,
        },
      ],
      metadata: {
        browser: {
          backend: input.backend,
          observation: input.observation,
          ...(url ? { url } : {}),
          ...(input.result.meta?.withheldFrames ? { withheldFrames: input.result.meta.withheldFrames } : {}),
        },
      },
    } as Tool.Result,
  }
}

/** The model-facing answer for one call: the observation mode, the images, and the metadata the UI reads. */
function shaped(input: {
  result: CallResult
  entry: Entry
  args: Record<string, unknown>
  active: BrowserBackend
  session: string
  context: Tool.Context
  permission: Option.Option<Permission.Interface>
  observation: Observation
  backend: Settings["backend"]
}) {
  return Effect.gen(function* () {
    const text = textOf(input.result)
    const next = snapshot(split(text))
    const mode = modeFor(input.entry.name, input.observation)
    const errors =
      mode === "diff" ? yield* consoleErrors(input.active, input.session, input.context, input.permission) : []
    const previous = mode === "diff" ? tracker.previous(input.session, input.entry.name, next?.url) : undefined
    const viewed = observe({ mode, text, previous, consoleErrors: errors })
    if (viewed.snapshot) tracker.record(input.session, viewed.snapshot)
    tracker.place(input.session, placed(input.entry.name, input.args, input.result))

    const content: Tool.Content[] = [{ type: "text", text: viewed.text }]
    for (const block of input.result.content) {
      if (block.type !== "image") continue
      const ext = block.mimeType.split("/")[1] || "png"
      content.push({
        type: "file",
        uri: `data:${block.mimeType};base64,${block.data}`,
        mime: block.mimeType,
        name: `browser-${input.entry.name}.${ext}`,
      })
    }

    return {
      content,
      metadata: {
        browser: {
          backend: input.backend,
          observation: input.observation,
          ...(next?.url ? { url: next.url } : {}),
          ...(next?.title ? { title: next.title } : {}),
          ...(input.result.meta?.withheldFrames ? { withheldFrames: input.result.meta.withheldFrames } : {}),
        },
      },
    } as Tool.Result
  })
}

function run(entry: Entry, args: unknown, context: Tool.Context, deps: Deps) {
  return Effect.gen(function* () {
    const browser = yield* settings(deps.config)
    // The tools leave the registry when the backend turns off; a call already planned against the old list still
    // refuses, and the model is told the user decided it, so it does not try to turn the browser back on.
    if (browser.backend === "off") return yield* new Tool.Error({ message: OFF_MESSAGE })

    const organization = yield* policy(deps.directory)
    if (organization?.control === "off")
      return yield* Effect.fail(new UnavailableError("Your organization turned off browser control in Kilo."))
    // One function decides the backend for a call and for the status RPC: the user's `off` wins, an organization that
    // allows Playwright only forces it, and otherwise the config decides, including the extension.
    const choice: Settings = { ...browser, backend: effective(browser, organization) }

    // The tool's own key first, so a config rule like `browser_click: deny` blocks it before anything runs.
    if (Option.isSome(deps.permission)) {
      yield* ask(
        deps.permission.value,
        {
          action: entry.name,
          resources: ["*"],
          save: [],
          metadata: { tool: entry.name },
          ...Permission.invocation(context),
        },
        entry.name,
      )
    }

    // The effect's interruption signal reaches the browser call, so cancelling the turn aborts the browser action.
    const active = yield* Effect.tryPromise({
      try: () => deps.backend(choice),
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
    const title = yield* deps.title(context.sessionID)

    // Ask, then call. A backend that discovers the real origin at action time (redirects, frames, sensitive elements,
    // downloads) reports it as needs_permission; the call is retried once with the new grants and the step token.
    let sensitive: string[] = []
    let result: CallResult | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      if (active.plan) {
        const planned = yield* Effect.tryPromise({
          try: () =>
            active.plan!(entry.name, input, {
              session,
              authorized: [...grants],
              sensitive: [...sensitive],
              allowSensitive,
            }),
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
              allowSensitive,
              title,
            }),
          catch: (error) => error,
        }),
      )
      if (Result.isSuccess(outcome)) {
        result = outcome.success
        break
      }
      const error = outcome.failure
      // A move already happened whether or not it asks for a grant: record it first, so a refusal never says the tab
      // is still on the page it left.
      tracker.place(session, movedTo(error))
      if (!(error instanceof NeedsPermissionError)) return yield* Effect.fail(error)
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
    if (result.meta?.needs?.length) {
      const settled = yield* postAction({
        needs: result.meta.needs,
        result,
        active,
        entry,
        input,
        session,
        grants,
        allowSensitive,
        observation: browser.observation,
        backend: choice.backend,
        context,
        permission: deps.permission,
        organization,
      })
      if (settled.kind === "result") return settled.result
      result = settled.result
    }

    return yield* shaped({
      args: input,
      result,
      entry,
      active,
      session,
      context,
      permission: deps.permission,
      observation: browser.observation,
      backend: choice.backend,
    })
  }).pipe(
    Effect.tapError((error) => deps.notify(context.sessionID, error)),
    Effect.mapError((error) => failure(error)),
  )
}

/**
 * Every browser tool of the pinned Playwright MCP contract, registered once per location. The input schema is the
 * contract's own JSON schema, so the model sees the upstream tool definition unchanged on every backend.
 */
export const KiloBrowserToolsPlugin = define<BrowserHub.Service | Scope.Scope>({
  id: "kilocode.browser-tools",
  effect: Effect.fn("KiloBrowserToolsPlugin")(function* (ctx) {
    const hub = yield* BrowserHub.Service
    // One extension backend per profile target: each holds the session handles opened on its own hub connection. The
    // backend module is loaded on the first extension call: it is not in the graph of a Playwright user's start, and a
    // static import cannot express that. A target change evicts the least recently used backend, and an evicted one is
    // disposed, so a session that keeps switching profiles cannot grow this map.
    const extensions = new Map<string, Promise<ExtensionBackend>>()
    const EXTENSION_LIMIT = 4
    // Each conversation's latest turn, numbered once per process: a Stop all halts the turns current at that moment, and
    // the conversation's next turn gets a new number, so it starts free. A deleted conversation leaves the map.
    const turns = new Map<string, number>()
    let turn = 0
    const extension = (target: string | null) => {
      const name = target ?? ""
      const existing = extensions.get(name)
      if (existing) {
        // Re-insert so the map's order is the recency order the eviction below reads.
        extensions.delete(name)
        extensions.set(name, existing)
        return existing
      }
      const created = import("./extension").then((module) =>
        module.backend({ port: hub.port(target), directory: ctx.location.directory, turns }),
      )
      extensions.set(name, created)
      trim(extensions, EXTENSION_LIMIT)
      return created
    }

    // The bundled browser lives as long as this location: the finalizer runs when the server shuts down.
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        tracker.clear()
        await playwright.dispose()
        await Promise.all(
          [...extensions.values()].map((pending) =>
            pending.then((backend) => backend.dispose()).catch(() => undefined),
          ),
        )
      }),
    )

    // A deleted session releases its remembered page at once, and each execution start numbers the session's turn. The
    // stream never ends, so it is forked: awaiting it here would keep the plugin effect from ever registering its tools.
    yield* ctx.event.subscribe({ types: ["session.deleted", "session.execution.started"] }).pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.type === "session.execution.started") {
            turn += 1
            turns.set(event.data.sessionID, turn)
            return
          }
          if (event.type !== "session.deleted") return
          turns.delete(event.data.sessionID)
          tracker.forget(event.data.sessionID)
          playwright.forgetSession(event.data.sessionID)
          for (const pending of extensions.values()) {
            void pending.then((backend) => backend.forget(event.data.sessionID)).catch(() => undefined)
          }
          forgetGrants(event.data.sessionID)
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

    // The tool set follows the config: a `config.updated` re-reads the browser block and the organization policy and
    // rebuilds the tools and the skill, so `off` hides them for the next turn and turning a backend on shows them,
    // without a restart. Subscribed before the first read, so an update racing it still rebuilds.
    const live: { browser: Settings; organization: KiloBrowserPolicy.Policy | undefined } = {
      browser: resolve(undefined),
      organization: undefined,
    }
    const read = Effect.gen(function* () {
      live.browser = yield* settings(config)
      live.organization = yield* policy(ctx.location.directory)
    })
    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() =>
        read.pipe(
          Effect.andThen(ctx.tool.reload()),
          Effect.andThen(ctx.skill.reload()),
          Effect.catchCause((cause) => Effect.logError("failed to reload the browser tools", { cause })),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* read

    // What a settings editor shows before it offers a backend: whether the Playwright one has a browser to start, the
    // backend after the organization policy, and the policy itself. The Playwright answer is read through the same
    // `locate` check the backend runs, so the dialog never calls it ready when a call would fail; the extension answer
    // is the hub connection's own report, connected or not. Neither starts a browser or a hub.
    const extensionStatus = (): Promise<KiloBrowserRpc.Extension> =>
      hub
        .port(live.browser.target)
        .reported()
        .then(
          (info): KiloBrowserRpc.Extension =>
            info === undefined
              ? { ready: false }
              : {
                  ready: true,
                  profileLabel: info.profileLabel,
                  contractSha: info.contractSha,
                  extensionVersion: info.extensionVersion,
                },
          () => ({ ready: false }),
        )
    // A session that is not titled yet, or cannot be read, leaves the backend's own fallback in place.
    const title = (sessionID: SessionID) =>
      ctx.session.get({ sessionID }).pipe(
        Effect.map((session) => (isFallbackTitle(session.title) ? undefined : session.title)),
        Effect.orElseSucceed(() => undefined),
      )
    // An organization that turned browser control off is its own answer: no backend the user picks in `/browser` could
    // share or adopt. The user's own `off` and a Playwright backend, chosen or pinned, need the extension chosen. The
    // conversation's title names the browser session when the command is the first to open it.
    const control = <A>(sessionID: SessionID, act: (active: ExtensionBackend, name?: string) => Promise<A>) =>
      Effect.gen(function* () {
        const current = yield* settings(config)
        const organization = yield* policy(ctx.location.directory)
        if (organization?.control === "off") return { kind: "organization_off" as const }
        if (effective(current, organization) !== "extension") return { kind: "not_extension" as const }
        const name = yield* title(sessionID)
        const named = (active: ExtensionBackend) => act(active, name)
        return yield* Effect.promise(() => extension(current.target).then(named).catch(refusal))
      }).pipe(Effect.orDie)
    const registration = yield* ctx.rpc
      .register(KiloBrowserRpc.Definition, {
        status: () =>
          Effect.promise(async () => ({
            playwright: await readiness().then(
              (value) => value,
              () => ({ ready: false as const }),
            ),
            extension: await extensionStatus(),
            backend: effective(live.browser, live.organization),
            ...(live.organization
              ? { organization: { control: live.organization.control, origins: [...live.organization.origins] } }
              : {}),
          })),
        share: ({ sessionID }) =>
          control(sessionID, (active, name) => active.share(sessionID, name).then(() => ({ kind: "shared" as const }))),
        adopt: ({ sessionID }) =>
          control(sessionID, (active, name) => active.adopt(sessionID, name).then((kind) => ({ kind }))),
      })
      .pipe(Effect.orDie)
    const notify = (sessionID: SessionID, error: unknown) => {
      const raised = notice(sessionID, error)
      return raised === undefined ? Effect.void : registration.events.emit("notice", raised).pipe(Effect.ignore)
    }

    yield* ctx.skill.transform((editor) => {
      // `off` hides the tools: an agent never sees a browser tool it cannot use.
      if (effective(live.browser, live.organization) === "off") return
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("browser-automation"),
          name: Skill.Name.make("browser-automation"),
          description: "Use to inspect or interact with a web page using Playwright.",
          path: AbsolutePath.make("/builtin/browser-automation.md"),
          content: GUIDE,
        }),
      )
    })
    yield* ctx.tool.transform((editor) => {
      if (effective(live.browser, live.organization) === "off") return
      const backend = (choice: Settings): Promise<BrowserBackend> =>
        choice.backend === "extension" ? extension(choice.target) : playwright.get(key(choice))
      const deps: Deps = { config, permission, directory: ctx.location.directory, backend, title, notify }
      for (const entry of BrowserContract.entries) {
        editor.add({
          // The registry flattens browser.click to browser_click, preserving permission and policy IDs.
          name: entry.name.slice("browser_".length),
          options: { namespace: "browser", codemode: true },
          description: entry.description,
          input: entry.inputSchema as JsonSchema.JsonSchema,
          execute: (args: unknown, context: Tool.Context) => run(entry, args, context, deps),
        })
      }
    })
  }),
})
