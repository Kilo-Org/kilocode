import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { local } from "../local"
import type { Command, Manager } from "../server"
import { installChromium } from "./install-chromium"
import { BrowserSettingsMigration } from "./migrate"
import { status as readStatus, type Status } from "./status"

export { BrowserSettingsMigration, type Status }

/**
 * The browser tools' settings: the `browser` block of the Kilo config (backend, observation, sensitive steps, headless)
 * and the `browser` permission rules the CLI enforces (`<class>:<origin>` and per-tool keys). Every surface — the
 * Settings panel, the TUI `/browser` command — writes the same keys through the same `kilocode.settings` RPC.
 */
export namespace BrowserSettings {
  export type Backend = "playwright" | "extension" | "off"
  export type Observation = "full" | "diff" | "none"
  export type Effect = "allow" | "ask" | "deny"
  /** What a grant lets a call do: read the page, act on it, or navigate it. */
  export type Class = "read" | "act" | "navigate"

  export type Input = {
    backend?: Backend
    observation?: Observation
    allow_sensitive?: boolean
    headless?: boolean
  }

  /** One permission rule of the origin allowlist. */
  export type Rule = { action: string; resource: string; effect: Effect }

  export type State = {
    backend: Backend
    observation: Observation
    allow_sensitive: boolean
    headless?: boolean
    /** Rules that name the browser permission, one `<class>:<origin>` resource each, plus the per-tool rules. */
    rules: Rule[]
    /** `{ action: "browser", resource: "*", effect: "allow" }`: every origin allowed without asking. */
    allowAll: boolean
  }

  export const DEFAULTS = { backend: "playwright", observation: "full", allow_sensitive: false } as const
  export const BACKENDS: readonly Backend[] = ["playwright", "extension", "off"]
  export const OBSERVATIONS: readonly Observation[] = ["full", "diff", "none"]

  /** One rule as a line: the editor's list, and the TUI's grants listing. */
  export function format(rule: Rule) {
    if (rule.action !== "browser") return `${rule.action} → ${rule.effect}`
    if (rule.resource === "*") return `every origin → ${rule.effect}`
    const index = rule.resource.indexOf(":")
    if (index < 0) return `${rule.resource} → ${rule.effect}`
    return `${rule.resource.slice(0, index)} on ${rule.resource.slice(index + 1)} → ${rule.effect}`
  }

  export function permissionRules(document: unknown): Rule[] {
    if (typeof document !== "object" || document === null) return []
    const permissions = (document as { permissions?: unknown }).permissions
    if (!Array.isArray(permissions)) return []
    return permissions.flatMap((rule): Rule[] => {
      if (typeof rule !== "object" || rule === null) return []
      const { action, resource, effect } = rule as Partial<Rule>
      if (typeof action !== "string" || typeof resource !== "string") return []
      if (effect !== "allow" && effect !== "ask" && effect !== "deny") return []
      return [{ action, resource, effect }]
    })
  }

  /** The settings from one config document, with the documented defaults applied. */
  export function read(document: unknown): State {
    const input =
      typeof document === "object" &&
      document !== null &&
      typeof (document as { browser?: unknown }).browser === "object" &&
      (document as { browser?: unknown }).browser !== null
        ? ((document as { browser: Input }).browser ?? {})
        : {}
    const rules = permissionRules(document)
    const browser = rules.filter((rule) => rule.action === "browser")
    return {
      backend: BACKENDS.includes(input.backend as Backend) ? (input.backend as Backend) : DEFAULTS.backend,
      observation: OBSERVATIONS.includes(input.observation as Observation)
        ? (input.observation as Observation)
        : DEFAULTS.observation,
      allow_sensitive: input.allow_sensitive === true,
      ...(typeof input.headless === "boolean" ? { headless: input.headless } : {}),
      rules: browser.filter((rule) => rule.resource !== "*"),
      allowAll: browser.some((rule) => rule.resource === "*" && rule.effect === "allow"),
    }
  }

  /**
   * The `set` payload that applies `patch`. Rules the editor does not own (provider, tool and the per-tool keys) are
   * kept, and so is a `browser` deny for a tool the user wrote by hand.
   */
  export function apply(
    state: State,
    document: unknown,
    patch: { browser?: Input; rules?: Rule[]; allowAll?: boolean },
  ) {
    const headless = patch.browser?.headless ?? state.headless
    const next = {
      backend: patch.browser?.backend ?? state.backend,
      observation: patch.browser?.observation ?? state.observation,
      allow_sensitive: patch.browser?.allow_sensitive ?? state.allow_sensitive,
      ...(headless === undefined ? {} : { headless }),
    }
    // The editor owns `browser` rules only; provider and tool rules are carried over untouched. Collected rules come
    // after them, so a specific origin rule wins over a catch-all allow.
    const keep = permissionRules(document).filter((rule) => rule.action !== "browser")
    const rules = (patch.rules ?? state.rules).filter((rule) => rule.action === "browser" && rule.resource !== "*")
    const own: Rule[] = [
      ...((patch.allowAll ?? state.allowAll) ? [{ action: "browser", resource: "*", effect: "allow" as const }] : []),
      ...rules,
    ]
    return { browser: next, permissions: [...keep, ...own] }
  }

  /** Add or replace the rule for one resource. */
  export function withRule(state: State, resource: string, effect: Effect): Rule[] {
    return [
      ...state.rules.filter((rule) => rule.action !== "browser" || rule.resource !== resource),
      { action: "browser", resource, effect },
    ]
  }

  /** Drop the rule for one resource. */
  export function withoutRule(state: State, resource: string): Rule[] {
    return state.rules.filter((rule) => rule.action !== "browser" || rule.resource !== resource)
  }

  /**
   * A `<class>:<origin>` resource as its parts. An origin carries a colon of its own, so only the first one splits.
   */
  export function originOf(resource: string): { type: string; origin: string } | undefined {
    const index = resource.indexOf(":")
    if (index <= 0 || index === resource.length - 1) return undefined
    return { type: resource.slice(0, index), origin: resource.slice(index + 1) }
  }

  /** Add one origin with every class asking, so the table lists it and each cell can be set. */
  export function addOrigin(state: State, origin: string): Rule[] {
    const present = new Set(
      state.rules.flatMap((rule) => {
        const parts = originOf(rule.resource)
        return parts?.origin === origin ? [parts.type] : []
      }),
    )
    return (["read", "act", "navigate"] as const)
      .filter((type) => !present.has(type))
      .reduce((rules, type) => withRule({ ...state, rules }, `${type}:${origin}`, "ask"), state.rules)
  }

  /** Drop every class rule of one origin. */
  export function withoutOrigin(state: State, origin: string): Rule[] {
    return state.rules.filter((rule) => rule.action !== "browser" || originOf(rule.resource)?.origin !== origin)
  }
}

type Store = {
  read: () => Promise<BrowserSettings.State>
  write: (patch: {
    browser?: BrowserSettings.Input
    rules?: BrowserSettings.Rule[]
    allowAll?: boolean
  }) => Promise<unknown>
}

/**
 * The global Kilo config document, read and written through the `kilocode.settings` RPC: a write keeps comments and
 * formatting, and a stale revision is refused instead of overwriting a newer file.
 */
export function documentStore(input: { client: () => Promise<OpenCodeClient>; directory: () => string }): Store {
  const call = async () => {
    const client = await input.client()
    const location = { location: { directory: input.directory() } }
    const settings = client.rpc(KiloSettingsRpc.Definition)
    const read = await settings.read({ scope: "global" }, location)
    return { settings, location, target: read.target, document: read.document }
  }
  return {
    async read() {
      const { document } = await call()
      return BrowserSettings.read(document)
    },
    async write(patch) {
      const { settings, location, target, document } = await call()
      const set = BrowserSettings.apply(BrowserSettings.read(document), document, patch)
      await settings.write(
        {
          scope: "global",
          // The RPC's values are JSON; these keys carry booleans, strings and rule objects only.
          set: set as never,
          ...(target.revision ? { expected: { path: target.path, revision: target.revision } } : {}),
        },
        location,
      )
    },
  }
}

/** One Settings-panel edit: the `browser` block, allow-all, or one class of one origin. */
export type Patch = {
  browser?: BrowserSettings.Input
  allowAll?: boolean
  /** Add an origin with every class asking. */
  site?: string
  /** Drop one origin and every class rule it has. */
  remove?: string
  /** Set one class of one origin. */
  cell?: { origin: string; type: BrowserSettings.Class; effect: BrowserSettings.Effect }
}

/** What the Settings panel reads and writes, and the two machine checks its status line shows. */
export type Service = {
  read: () => Promise<BrowserSettings.State>
  write: (patch: Patch) => Promise<BrowserSettings.State>
  status: () => Promise<Status>
  install: () => Promise<{ ok: boolean; error?: string; status: Status }>
  migrate: () => Promise<BrowserSettingsMigration.Result>
}

/**
 * The one owner of the browser settings' file writes: the panel, and the migration that runs once on activation.
 */
export function browserSettingsService(input: {
  server: Manager
  directory: () => string
  /** `Global.Path.data` of the spawned server, where the installed Chromium and the hub registry live. */
  data: string
  /** The CLI the extension starts, so `install-chromium` writes where that CLI reads. */
  command: () => Command | undefined
  state: {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): PromiseLike<void>
  }
  env?: NodeJS.ProcessEnv
  log?: (...args: unknown[]) => void
}): Service {
  let cached: { url: string; client: OpenCodeClient } | undefined
  const client = async () => {
    const server = await input.server.get()
    if (cached?.url === server.url) return cached.client
    const created = OpenCode.make({
      baseUrl: server.url,
      headers: { authorization: server.authorization },
      fetch: local,
    })
    cached = { url: server.url, client: created }
    return created
  }
  const store = documentStore({ client, directory: input.directory })
  const current = () => readStatus({ data: input.data, env: input.env })

  const write = async (patch: Patch) => {
    // A site edit is expressed against the rules already in the file, so the panel never has to send the whole list.
    const state = await store.read()
    const rules =
      patch.site !== undefined
        ? BrowserSettings.addOrigin(state, patch.site)
        : patch.remove !== undefined
          ? BrowserSettings.withoutOrigin(state, patch.remove)
          : patch.cell
            ? BrowserSettings.withRule(state, `${patch.cell.type}:${patch.cell.origin}`, patch.cell.effect)
            : undefined
    await store.write({ browser: patch.browser, allowAll: patch.allowAll, ...(rules ? { rules } : {}) })
    return store.read()
  }

  const install = async () => {
    const found = input.command()
    if (!found) return { ok: false, error: "The Kilo CLI was not found.", status: current() }
    const result = await installChromium({
      command: found,
      cwd: input.directory(),
      env: input.env ?? process.env,
      log: (text) => input.log?.(text),
    })
    return {
      ok: result.ok,
      ...(result.ok ? {} : { error: result.output.split("\n").slice(-1)[0] || "Chromium install failed." }),
      status: current(),
    }
  }

  return {
    read: () => store.read(),
    write,
    status: async () => current(),
    install,
    migrate: () =>
      BrowserSettingsMigration.run({
        state: input.state,
        log: input.log,
        write: async (browser) => {
          await store.write({ browser })
        },
      }),
  }
}
