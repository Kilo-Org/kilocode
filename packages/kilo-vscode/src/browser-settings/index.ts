import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { commands, window, workspace, type Disposable, type QuickPickItem } from "vscode"
import { local } from "../local"
import type { Manager } from "../server"
import { BrowserSettingsMigration } from "./migrate"

export { BrowserSettingsMigration }

/**
 * The browser tools' settings: the `browser` block of the Kilo config (backend, observation, sensitive steps, headless)
 * and the `browser` permission rules the CLI enforces (`<class>:<origin>` and per-tool keys). Every surface — these
 * editor commands, the TUI `/browser` command — writes the same keys through the same `kilocode.settings` RPC.
 */
export namespace BrowserSettings {
  export type Backend = "playwright" | "extension" | "off"
  export type Observation = "full" | "diff" | "none"
  export type Effect = "allow" | "ask" | "deny"

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
  export function apply(state: State, document: unknown, patch: { browser?: Input; rules?: Rule[]; allowAll?: boolean }) {
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
}

type Store = {
  read: () => Promise<BrowserSettings.State>
  write: (patch: { browser?: BrowserSettings.Input; rules?: BrowserSettings.Rule[]; allowAll?: boolean }) => Promise<unknown>
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

/** Commands, and the migration that runs once on activation. */
export function browserSettingsHost(input: {
  server: Manager
  state: {
    get<T>(key: string): T | undefined
    update(key: string, value: unknown): PromiseLike<void>
  }
  log?: (...args: unknown[]) => void
}): Disposable {
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
  const store = documentStore({
    client,
    directory: () => workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
  })

  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    input.log?.("failed", message)
    void window.showErrorMessage(message)
  }
  const pick = async <T extends string>(title: string, items: (QuickPickItem & { value: T })[]) =>
    (await window.showQuickPick(items, { title, placeHolder: title }))?.value

  const selectBackend = async () => {
    try {
      const state = await store.read()
      const value = await pick("Browser backend", [
        { label: "Bundled browser (Playwright)", description: "a Kilo-owned in-memory Chromium profile", value: "playwright" as const, picked: state.backend === "playwright" },
        { label: "Kilo browser extension", description: "your own browser, through the extension", value: "extension" as const, picked: state.backend === "extension" },
        { label: "Off", description: "hide the browser tools", value: "off" as const, picked: state.backend === "off" },
      ])
      if (!value) return
      await store.write({ browser: { backend: value } })
      void window.showInformationMessage(`Browser backend: ${value}`)
    } catch (error) {
      report(error)
    }
  }

  const selectObservation = async () => {
    try {
      const state = await store.read()
      const value = await pick("Browser observation", [
        { label: "Full", description: "the page snapshot after every action", value: "full" as const, picked: state.observation === "full" },
        { label: "Diff", description: "only what changed since the previous call", value: "diff" as const, picked: state.observation === "diff" },
        { label: "None", description: "status, URL and title only", value: "none" as const, picked: state.observation === "none" },
      ])
      if (!value) return
      await store.write({ browser: { observation: value } })
      void window.showInformationMessage(`Browser observation: ${value}`)
    } catch (error) {
      report(error)
    }
  }

  const toggleSensitive = async () => {
    try {
      const state = await store.read()
      const next = !state.allow_sensitive
      await store.write({ browser: { allow_sensitive: next } })
      void window.showInformationMessage(
        next
          ? "Sensitive browser steps (passwords, payment forms, uploads) run without asking."
          : "Sensitive browser steps ask a person before they run.",
      )
    } catch (error) {
      report(error)
    }
  }

  /** The allowlist editor: allow-all, one row per rule, and an entry to add an origin. */
  const allowlist = async () => {
    try {
      const state = await store.read()
      const chosen = await pick("Browser origin allowlist", [
        {
          label: state.allowAll ? "$(check) Allow all origins" : "$(circle-slash) Allow all origins",
          description: state.allowAll ? "every origin is allowed without asking" : "an origin the rules do not cover asks",
          value: "allow-all" as const,
          picked: state.allowAll,
        },
        { label: "$(add) Add an origin…", description: "class:origin, for example read:https://example.com", value: "add" as const },
        ...state.rules.map((rule) => ({
          label: BrowserSettings.format(rule),
          description: rule.action === "browser" ? "origin rule" : "tool rule",
          value: `rule:${rule.action}:${rule.resource}` as const,
        })),
      ])
      if (!chosen) return
      if (chosen === "allow-all") {
        await store.write({ allowAll: !state.allowAll })
        return
      }
      if (chosen === "add") {
        const resource = await window.showInputBox({
          title: "Allow a browser origin",
          prompt: "class:origin — read, act or navigate, then the origin",
          placeHolder: "read:https://example.com",
          validateInput: (value) =>
            /^(read|act|navigate):https?:\/\/[^\s]+$/.test(value.trim()) ? undefined : "Use <class>:<origin>",
        })
        if (!resource) return
        const effect = await pick("Effect", [
          { label: "Allow", value: "allow" as const },
          { label: "Ask", value: "ask" as const },
          { label: "Deny", value: "deny" as const },
        ])
        if (!effect) return
        await store.write({ rules: BrowserSettings.withRule(state, resource.trim(), effect) })
        return
      }
      const [, action, ...rest] = chosen.split(":")
      const resource = rest.join(":")
      const rule = state.rules.find((item) => item.action === action && item.resource === resource)
      if (!rule) return
      const next = await pick(BrowserSettings.format(rule), [
        { label: "Remove", value: "remove" as const },
        { label: "Allow", value: "allow" as const, picked: rule.effect === "allow" },
        { label: "Ask", value: "ask" as const, picked: rule.effect === "ask" },
        { label: "Deny", value: "deny" as const, picked: rule.effect === "deny" },
      ])
      if (!next) return
      await store.write({
        rules:
          next === "remove"
            ? BrowserSettings.withoutRule(state, rule.resource)
            : BrowserSettings.withRule(state, rule.resource, next),
      })
    } catch (error) {
      report(error)
    }
  }

  void BrowserSettingsMigration.run({
    state: input.state,
    log: input.log,
    write: async (browser) => {
      await store.write({ browser })
    },
  }).catch((error) => report(error))

  const registered = [
    commands.registerCommand("kilo-code.v2.browserSelectBackend", selectBackend),
    commands.registerCommand("kilo-code.v2.browserSelectObservation", selectObservation),
    commands.registerCommand("kilo-code.v2.browserToggleSensitive", toggleSensitive),
    commands.registerCommand("kilo-code.v2.browserAllowlist", allowlist),
  ]
  return { dispose: () => registered.forEach((item) => item.dispose()) }
}
