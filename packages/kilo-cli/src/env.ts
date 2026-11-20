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
  "CONFIG_CONTENT",
  "DISABLE_AUTOUPDATE",
  "DISABLE_CLAUDE_CODE",
  "DISABLE_CLAUDE_CODE_PROMPT",
  "DISABLE_CLAUDE_CODE_SKILLS",
  "DISABLE_FFF",
  "DISABLE_MODELS_FETCH",
  "DISABLE_PROJECT_CONFIG",
  "GIT_BASH_PATH",
  "MODELS_PATH",
  "MODELS_URL",
  "SERVER_PASSWORD",
  "SHOW_TTFD",
  "TEST_HOME", // kilo_port(global:b9f635c56864) - KILO_TEST_HOME overrides the home directory in tests
] as const

/**
 * The variables that point at a config file, a config directory or the database. v1 Kilo reads them as KILO_<NAME>,
 * and clients must pass the same selectors to preflight and the runtime. Translation alone never opens SQLite.
 */
export const storage = ["CONFIG", "CONFIG_DIR", "DB"] as const

/**
 * Copies each supported KILO_<NAME> to OPENCODE_<NAME>. The Kilo name wins when both are set.
 */
export function translate(env: Record<string, string | undefined>) {
  for (const name of [...names, ...storage]) {
    const value = env[`KILO_${name}`]
    if (value !== undefined) env[`OPENCODE_${name}`] = value
  }
  env.OPENCODE_TUI_USE_PINNED_MODE ??= "1"
  env.OPENCODE_TUI_OVERLAP_STARTUP ??= "1"
}

/** Set before importing modules that capture Global.Path at module load. */
export const directory = "kilo"

/** Pin the verified stable selectors before global-boot, for the CLI and its children. */
export function releaseProfile(file: string, config: string, explicitFile?: string) {
  process.env.OPENCODE_APP_DIR_NAME = directory
  process.env.OPENCODE_DB = file
  process.env.OPENCODE_CONFIG_DIR = config
  if (explicitFile) process.env.OPENCODE_CONFIG = explicitFile
}

translate(process.env)
process.env.OPENCODE_APP_DIR_NAME = directory // kilo_port(global:0e189a57d108)
