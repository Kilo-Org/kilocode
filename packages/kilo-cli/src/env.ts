// KILO_* environment translation (host composition, rung 2). Kilo users set KILO_<NAME>; the upstream runtime
// reads OPENCODE_<NAME>. The entry imports this module first, so the translation runs before an upstream module
// reads the environment. Child processes (the background service, a standalone server) inherit the result.

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

translate(process.env)
