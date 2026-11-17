import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { local } from "../local"
import type { Command, Manager } from "../server"
import { defaultAllow } from "../shared/browser-permissions"
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
    /** Every `browser` rule in document order: one `<class>:<origin>` each, plus any `*` catch-all the user wrote. */
    rules: Rule[]
    /** `{ action: "browser", resource: "*", effect: "allow" }` is present: every origin allowed without asking. */
    allowAll: boolean
  }

  export const DEFAULTS = { backend: "playwright", observation: "diff", allow_sensitive: false } as const
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
      rules: browser,
      allowAll: browser.some((rule) => rule.resource === "*" && rule.effect === "allow"),
    }
  }

  /**
   * The `set` payload that applies `patch`. Every rule keeps its document position: an edited rule is replaced where
   * it stands, a removed rule is dropped, and a new rule is appended. Resolution is last-match-wins, so a new
   * catch-all goes before the first origin rule (the origin rules still win) and a new origin rule goes last.
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
    // The editor owns `browser` rules only; provider and tool rules are carried over untouched, at their position.
    const rules = (patch.rules ?? state.rules).filter((rule) => rule.action === "browser")
    const desired =
      patch.allowAll === undefined
        ? rules
        : patch.allowAll
          ? withAllowAll(rules)
          : rules.filter((rule) => !(rule.resource === "*" && rule.effect === "allow"))
    return { browser: next, permissions: merge(permissionRules(document), desired) }
  }

  /**
   * The catch-all allow is a baseline, never an override: it goes after the catch-alls the user wrote and before the
   * first origin rule, so a specific origin rule still wins and a hand-written `*` rule keeps its effect.
   */
  function withAllowAll(rules: Rule[]): Rule[] {
    if (rules.some((rule) => rule.resource === "*" && rule.effect === "allow")) return rules
    const index = rules.findIndex((rule) => rule.resource !== "*")
    const at = index < 0 ? rules.length : index
    return [...rules.slice(0, at), { action: "browser", resource: "*", effect: "allow" }, ...rules.slice(at)]
  }

  /**
   * Write the desired browser rules into the document's rule list at the positions the file already uses. A rule the
   * document names keeps its place with the new effect; one it does not name is appended (catch-alls first, so the
   * origin rules that follow still win), and every rule the panel does not own stays untouched.
   */
  function merge(rules: Rule[], desired: Rule[]): Rule[] {
    // A resource can appear more than once (`*` deny then `*` allow); each document rule takes the next desired
    // rule of its own resource, in order, so a duplicate keeps its multiplicity and its place.
    const pending = new Map<string, Rule[]>()
    for (const rule of desired) {
      const list = pending.get(rule.resource)
      if (list) list.push(rule)
      else pending.set(rule.resource, [rule])
    }
    const merged: Rule[] = []
    for (const rule of rules) {
      if (rule.action !== "browser") {
        merged.push(rule)
        continue
      }
      const list = pending.get(rule.resource)
      const hit = list?.shift()
      if (!list || !hit) continue
      if (list.length === 0) pending.delete(rule.resource)
      merged.push(hit)
    }
    const added = [...pending.values()].flat()
    const catchAlls = added.filter((rule) => rule.resource === "*")
    const specific = added.filter((rule) => rule.resource !== "*")
    const first = merged.findIndex((rule) => rule.action === "browser" && rule.resource !== "*")
    const at = first < 0 ? merged.length : first
    return [...merged.slice(0, at), ...catchAlls, ...merged.slice(at), ...specific]
  }

  /** Add or replace the rule for one resource, keeping the position of an existing one. */
  export function withRule(state: State, resource: string, effect: Effect): Rule[] {
    const index = state.rules.findIndex((rule) => rule.action === "browser" && rule.resource === resource)
    if (index < 0) return [...state.rules, { action: "browser", resource, effect }]
    return state.rules.map((rule, at) => (at === index ? { action: "browser", resource, effect } : rule))
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

  /**
   * Add one origin so the table lists it and each cell can be set. A new class gets the effect the CLI already applies
   * — allow on the localhost family, ask elsewhere — so adding an origin does not change what the CLI does.
   */
  export function addOrigin(state: State, origin: string): Rule[] {
    const present = new Set(
      state.rules.flatMap((rule) => {
        const parts = originOf(rule.resource)
        return parts?.origin === origin ? [parts.type] : []
      }),
    )
    const effect = defaultAllow(origin) ? "allow" : "ask"
    return (["read", "act", "navigate"] as const)
      .filter((type) => !present.has(type))
      .reduce((rules, type) => withRule({ ...state, rules }, `${type}:${origin}`, effect), state.rules)
  }

  /** Drop every class rule of one origin. */
  export function withoutOrigin(state: State, origin: string): Rule[] {
    return state.rules.filter((rule) => rule.action !== "browser" || originOf(rule.resource)?.origin !== origin)
  }
}

/** One write to the config document: the parsed file, and the revision the RPC refuses to overwrite. */
export type Snapshot = { path: string; revision?: string; document: unknown }

/** The two calls a write needs, so a test can describe a revision-guarded file instead of running a server. */
export type Access = {
  read: () => Promise<Snapshot>
  write: (set: unknown, expected?: { path: string; revision: string }) => Promise<unknown>
}

/** The keys a write may change. A `rules` list replaces the panel's browser rules; the others merge with the file. */
export type WritePatch = {
  browser?: BrowserSettings.Input
  rules?: BrowserSettings.Rule[]
  allowAll?: boolean
}

/** What the store may build from the file it just read: a patch, or nothing when the file is already correct. */
export type Builder = (input: { state: BrowserSettings.State; document: unknown }) => WritePatch | undefined

export type Store = {
  read: () => Promise<BrowserSettings.State>
  /** Apply one patch and answer with the state the file holds afterwards. */
  write: (patch: WritePatch) => Promise<BrowserSettings.State>
  /** Read, build and write as one serialized step, so the patch sees the newest file. */
  update: (build: Builder) => Promise<BrowserSettings.State>
}

/**
 * The global Kilo config document: a write keeps comments and formatting, and a stale revision is refused instead of
 * overwriting a newer file. Every write is one step of a per-store queue and re-reads the revision when it starts, so
 * two edits that began together apply one after the other instead of the second failing on the first one's revision.
 */
export function documentStore(access: () => Promise<Access>): Store {
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const apply = (build: Builder) => async () => {
    const file = await access()
    const snapshot = await file.read()
    const state = BrowserSettings.read(snapshot.document)
    const patch = build({ state, document: snapshot.document })
    if (!patch) return state
    const set = BrowserSettings.apply(state, snapshot.document, patch)
    await file.write(
      // The RPC's values are JSON; these keys carry booleans, strings and rule objects only.
      set as never,
      snapshot.revision ? { path: snapshot.path, revision: snapshot.revision } : undefined,
    )
    return BrowserSettings.read(set)
  }
  return {
    async read() {
      const file = await access()
      return BrowserSettings.read((await file.read()).document)
    },
    write: (patch) => serial(apply(() => patch)),
    update: (build) => serial(apply(build)),
  }
}

/** The `kilocode.settings` RPC of the spawned server, as the two calls the store needs. */
function rpcAccess(input: { client: () => Promise<OpenCodeClient>; directory: () => string }): () => Promise<Access> {
  return async () => {
    const client = await input.client()
    const location = { location: { directory: input.directory() } }
    const settings = client.rpc(KiloSettingsRpc.Definition)
    return {
      read: async () => {
        const read = await settings.read({ scope: "global" }, location)
        return {
          path: read.target.path,
          ...(read.target.revision ? { revision: read.target.revision } : {}),
          document: read.document,
        }
      },
      // The RPC's values are JSON; the store builds rule objects and booleans only.
      write: (set, expected) =>
        settings.write({ scope: "global", set: set as never, ...(expected ? { expected } : {}) }, location),
    }
  }
}

/** One Settings-panel edit: the `browser` block, allow-all, or one class of one origin. */
export type Patch = {
  browser?: BrowserSettings.Input
  allowAll?: boolean
  /** Add an origin, with the effect the CLI already applies to it. */
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
  /** One install at a time; `onProgress` receives the installer's output as it arrives. */
  install: (onProgress?: (line: string) => void) => Promise<{ ok: boolean; error?: string; status: Status }>
  migrate: () => Promise<BrowserSettingsMigration.Result>
}

/**
 * The one owner of the browser settings' file writes: the panel, and the migration that runs once on activation.
 */
export function browserSettingsService(input: {
  server: Manager
  directory: () => string
  /** `Global.Path.data` of the spawned server, where the installed Chromium lives. */
  data: string
  /** `Global.Path.state` of the spawned server, where the hub registry lives. */
  state: string
  /** The CLI the extension starts, so `install-chromium` writes where that CLI reads. */
  command: () => Command | undefined
  /** The extension's global state, which remembers that the one-time migration ran. */
  store: {
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
  const store = documentStore(rpcAccess({ client, directory: input.directory }))
  const current = () => readStatus({ data: input.data, state: input.state, env: input.env })

  const write = (patch: Patch) =>
    // A site edit is expressed against the rules already in the file, so the panel never has to send the whole list.
    store.update(({ state }) => {
      const rules =
        patch.site !== undefined
          ? BrowserSettings.addOrigin(state, patch.site)
          : patch.remove !== undefined
            ? BrowserSettings.withoutOrigin(state, patch.remove)
            : patch.cell
              ? BrowserSettings.withRule(state, `${patch.cell.type}:${patch.cell.origin}`, patch.cell.effect)
              : undefined
      return { browser: patch.browser, allowAll: patch.allowAll, ...(rules ? { rules } : {}) }
    })

  const install = async (onProgress?: (line: string) => void) => {
    const found = input.command()
    if (!found) return { ok: false, error: "The Kilo CLI was not found.", status: current() }
    const result = await installChromium({
      command: found,
      cwd: input.directory(),
      env: input.env ?? process.env,
      log: (text) => input.log?.(text),
      onProgress,
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
        state: input.store,
        log: input.log,
        // The legacy values only fill `browser` keys the user has not set, and the fill runs on the document read at
        // write time, inside the store's queue.
        write: (browser) => {
          let wrote: string[] = []
          return store
            .update(({ document }) => {
              const next = BrowserSettingsMigration.fill(document, browser)
              wrote = Object.keys(next)
              return wrote.length ? { browser: next } : undefined
            })
            .then(() => wrote)
        },
      }),
  }
}
