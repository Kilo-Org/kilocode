// KILO_* environment translation (host composition, rung 2). Kilo users set KILO_<NAME>; the upstream runtime
// reads OPENCODE_<NAME>. The entry imports this module first, so the translation runs before an upstream module
// reads the environment. Child processes (the background service, a standalone server) inherit the result. It also
// names Kilo's app directory (`directory` below).

/**
 * The v1 Kilo variables (`packages/core/src/flag/flag.ts` and `packages/opencode/src/effect/runtime-flags.ts` on
 * `main`) whose OPENCODE_ name the v2 runtime reads. A prefix rule for all KILO_* variables is not safe:
 * `KILO_API_KEY` is the Kilo Gateway token, and v2 reads `OPENCODE_API_KEY` as the OpenCode Zen key.
 */
export const names = [
  "CLIENT",
  "CONFIG",
  "CONFIG_CONTENT",
  "CONFIG_DIR",
  "DB",
  "DISABLE_AUTOUPDATE",
  "DISABLE_CHANNEL_DB",
  "DISABLE_CLAUDE_CODE",
  "DISABLE_CLAUDE_CODE_SKILLS",
  "DISABLE_FFF",
  "DISABLE_MODELS_FETCH",
  "DISABLE_PROJECT_CONFIG",
  "GIT_BASH_PATH",
  "MODELS_PATH",
  "MODELS_URL",
  "SERVER_PASSWORD",
  "SHOW_TTFD",
] as const

/** Copies each set KILO_<NAME> to OPENCODE_<NAME>. The Kilo name wins when both are set. */
export function translate(env: Record<string, string | undefined>) {
  for (const name of names) {
    const value = env[`KILO_${name}`]
    if (value !== undefined) env[`OPENCODE_${name}`] = value
  }
}

/**
 * Kilo v2's app directory name (D-4): config, data, cache, state and tmp are `<XDG base>/kilo2`, apart from both
 * upstream's `opencode` and v1 Kilo's `kilo` directories during internal releases. Release migration to `kilo`
 * is explicit (U-E3-03, U-E8-02); v1 storage remains separate while v1 clients ship. The upstream
 * global paths read it when their module loads (`packages/util/src/global.ts`), so every path follows it: the
 * `Global` service, logs, locks, tmp and the database. Every process the host starts runs this module first.
 */
export const directory = "kilo2"

translate(process.env)
process.env.OPENCODE_APP_DIR_NAME = directory // kilo_port(global:0e189a57d108)
