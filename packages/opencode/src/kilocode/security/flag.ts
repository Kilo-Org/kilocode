import { Effect } from "effect"
import { Config } from "@/config/config"
import { ToolCapability } from "./tool/capability"

/**
 * Security Auto Mode is off by default. It is enabled from user-owned state only: the global Kilo
 * config (`experimental.security_auto: true`) or the `KILO_SECURITY_AUTO` environment variable.
 * Project config is deliberately ignored so a repository cannot turn the mode on or off, and the
 * global config directory is itself protected from agent writes by the engine's hard rules.
 *
 * The layers (package provenance preflight, stateful secret-egress protection, delegated-authority
 * classification of MCP / custom tools) follow the same rule: on by default whenever the mode is on,
 * switchable off individually from the global config (`experimental.security_auto_packages`,
 * `experimental.security_auto_egress`, `experimental.security_auto_tools`) or the environment
 * (`KILO_SECURITY_AUTO_PACKAGES`, `KILO_SECURITY_AUTO_EGRESS`, `KILO_SECURITY_AUTO_TOOLS`). They are
 * never read from a project.
 */
export namespace SecurityFlag {
  export interface Layers {
    /** Pre-install package provenance / lifecycle preflight. */
    packages: boolean
    /** Stateful sensitive-read → outbound-egress protection. */
    egress: boolean
    /** Delegated-authority classification of MCP / custom / unclassified tools. */
    tools: boolean
    /** Secret classification of content the agent actually obtained. */
    content: boolean
    /** Trust boundary for executable project code, evaluated before import. */
    code: boolean
    /** Permissioned host process for approved project extensions. */
    runtime: boolean
    /**
     * Semantic review of actions the deterministic layers left unsettled.
     *
     * On with the mode, like every other layer — but what actually switches it on is whether a model
     * provider resolves. With none configured the layer returns nothing on every call, which is the
     * same behaviour as running without this code at all. So "is the AI on" is answered by the
     * model the user already set up, not by a second flag they have to find.
     */
    classifier: boolean
  }

  function truthy(value: string | undefined) {
    return value === "1" || value === "true"
  }

  function falsy(value: string | undefined) {
    return value === "0" || value === "false"
  }

  /**
   * Read the global config, treating *any* failure as "not configured".
   *
   * The mode is off unless the user turned it on, so a config that cannot be read means off — the
   * previous behaviour, exactly. `Effect.catch` alone is not enough: a `Config` service that does not
   * implement `getGlobal` (test layers do this, and legitimately) throws when the method is
   * *accessed*, before any Effect exists to fail. `Effect.suspend` moves that access inside the
   * Effect so it becomes a defect, and the cause handler turns it into `undefined`. Without this, one
   * flag lookup on a partial Config service takes down whatever was loading — a plugin host, a tool
   * registry — which is a far worse outcome than the flag being read as off.
   */
  export const globalConfig = Effect.fn("SecurityFlag.globalConfig")(function* (
    config: Pick<Config.Interface, "getGlobal">,
  ) {
    return yield* Effect.suspend(() => config.getGlobal()).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
  })

  export const enabled = Effect.fn("SecurityFlag.enabled")(function* (config: Pick<Config.Interface, "getGlobal">) {
    if (truthy(process.env["KILO_SECURITY_AUTO"])) return true
    if (falsy(process.env["KILO_SECURITY_AUTO"])) return false
    const global = yield* globalConfig(config)
    return global?.experimental?.security_auto === true
  })

  function layer(env: string | undefined, configured: boolean | undefined) {
    if (truthy(env)) return true
    if (falsy(env)) return false
    return configured !== false
  }

  /** Which layers are active. Meaningful only when {@link enabled} is true. */
  export const layers = Effect.fn("SecurityFlag.layers")(function* (config: Pick<Config.Interface, "getGlobal">) {
    const global = yield* globalConfig(config)
    const result: Layers = {
      packages: layer(process.env["KILO_SECURITY_AUTO_PACKAGES"], global?.experimental?.security_auto_packages),
      egress: layer(process.env["KILO_SECURITY_AUTO_EGRESS"], global?.experimental?.security_auto_egress),
      tools: layer(process.env["KILO_SECURITY_AUTO_TOOLS"], global?.experimental?.security_auto_tools),
      content: layer(process.env["KILO_SECURITY_AUTO_CONTENT"], global?.experimental?.security_auto_content),
      code: layer(process.env["KILO_SECURITY_AUTO_CODE"], global?.experimental?.security_auto_code),
      runtime: layer(
        process.env["KILO_SECURITY_AUTO_EXTENSION_RUNTIME"],
        global?.experimental?.security_auto_extension_runtime,
      ),
      classifier: layer(process.env["KILO_SECURITY_AUTO_CLASSIFIER"], global?.experimental?.security_auto_classifier),
    }
    return result
  })

  /**
   * How long a decision may wait on the advisory model before the deterministic answer stands.
   * `KILO_SECURITY_AUTO_CLASSIFIER_TIMEOUT_MS`, default 2500 ms.
   *
   * The design note named 300 ms, written before anything had measured a real model. Measured, with
   * `claude-haiku-4.5` over a hosted gateway: about 960 ms median and 1215 ms at p95 from a quiet
   * process, and 1250 / 2475 ms while the benchmark is running scenarios around it. At 300 ms the
   * layer times out on essentially every call — which is safe, because a timeout contributes nothing,
   * and useless, because contributing nothing is also what being switched off does. A budget that
   * makes a feature silent is not a latency guarantee; it is a way of not noticing the feature is off.
   *
   * So the default covers the measured tail, and the cost is stated rather than hidden: up to 2.5 s
   * added to a decision, on the decisions the router actually sends — 0.16 of them in the benchmark.
   * A faster model wants a smaller number; a deployment that prefers the old budget can set one and
   * will get a layer that mostly says nothing.
   */
  export function classifierTimeoutMs(): number {
    const raw = Number(process.env["KILO_SECURITY_AUTO_CLASSIFIER_TIMEOUT_MS"])
    return Number.isFinite(raw) && raw > 0 ? raw : 2500
  }

  /**
   * Is the executable-code trust boundary active? Resolved on its own because the loaders that need
   * it run during instance initialisation, long before any session or gate options exist.
   */
  export const codeEnabled = Effect.fn("SecurityFlag.codeEnabled")(function* (
    config: Pick<Config.Interface, "getGlobal">,
  ) {
    if (!(yield* enabled(config))) return false
    const global = yield* globalConfig(config)
    return layer(process.env["KILO_SECURITY_AUTO_CODE"], global?.experimental?.security_auto_code)
  })

  /**
   * Is the permissioned extension runtime active? Resolved on its own for the same reason
   * {@link codeEnabled} is: the loaders run long before any session or gate options exist.
   */
  export const runtimeEnabled = Effect.fn("SecurityFlag.runtimeEnabled")(function* (
    config: Pick<Config.Interface, "getGlobal">,
  ) {
    if (!(yield* enabled(config))) return false
    const global = yield* globalConfig(config)
    return layer(
      process.env["KILO_SECURITY_AUTO_EXTENSION_RUNTIME"],
      global?.experimental?.security_auto_extension_runtime,
    )
  })

  /**
   * Capability declarations for tools the user vouches for (`experimental.security_auto_tool_capabilities`).
   * Global config only, for the same reason the mode itself is: a repository must not be able to
   * declare capabilities for the tools it also ships.
   */
  export const declarations = Effect.fn("SecurityFlag.declarations")(function* (
    config: Pick<Config.Interface, "getGlobal">,
  ) {
    const global = yield* globalConfig(config)
    return ToolCapability.declarations(global?.experimental?.security_auto_tool_capabilities)
  })
}
