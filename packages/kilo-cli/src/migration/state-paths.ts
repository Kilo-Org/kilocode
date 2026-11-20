import { accessSync, constants, statSync } from "node:fs"
import path from "node:path"

/** Pre-consent counterpart of KiloGlobalResilience.resolveState. Never mkdir or
 * create a write probe. Accepted hosts pin the selected target for normal boot. */
export function statePaths(env: NodeJS.ProcessEnv, data: string, home: string) {
  const explicit =
    env.XDG_STATE_HOME && env.XDG_STATE_HOME !== env.KILO_INTERNAL_CUTOVER_IMPLICIT_STATE
      ? env.XDG_STATE_HOME
      : undefined
  const stateBase = path.resolve(explicit || path.join(home, ".local", "state"))
  const stable = path.join(stateBase, "kilo"),
    preview = path.join(stateBase, "kilo2")
  return {
    stateBase,
    implicitState: !explicit,
    legacyState: explicit ? stable : choose(stable, path.join(data, "kilo/kilo")),
    v1State: explicit ? stable : choose(stable, path.join(data, "kilo/state")),
    previewState: explicit ? preview : choose(preview, path.join(data, "kilo2/kilo2")),
  }
}

function choose(preferred: string, fallback: string) {
  if (writable(fallback, false)) return fallback
  return writable(preferred, true) ? preferred : fallback
}

function writable(dir: string, allowCreate: boolean): boolean {
  try {
    accessSync(dir, constants.W_OK | constants.X_OK)
    return statSync(dir).isDirectory()
  } catch (error) {
    return (
      allowCreate &&
      (error as NodeJS.ErrnoException).code === "ENOENT" &&
      dir !== path.dirname(dir) &&
      writable(path.dirname(dir), true)
    )
  }
}
