// The global config directory the spawned server uses, for the case where `api.config.get` has no global directory
// entry because the directory does not exist yet. Mirrors `packages/util/src/global.ts` and the dev entry:
// `KILO_CONFIG_DIR`/`OPENCODE_CONFIG_DIR` wins; in dev (`KILO_V2_PROFILE`) the server config home is
// `<profile>/config`; otherwise `<XDG_CONFIG_HOME or ~/.config>/<app>`.
import { realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export function resolveGlobalConfigDir(env: NodeJS.ProcessEnv, profile: string): string {
  // The server runs `packages/kilo-cli/src/env.ts` first: `KILO_CONFIG_DIR` wins over `OPENCODE_CONFIG_DIR`, and the
  // app directory is fixed to `kilo2` regardless of the environment, so the host must match both.
  const configured = env.KILO_CONFIG_DIR ?? env.OPENCODE_CONFIG_DIR
  if (configured) return configured
  const base = profile ? path.join(profile, "config") : (env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"))
  return path.join(base, "kilo2")
}

/**
 * The real path of a file, or of its parent when the file does not exist yet. The server reports real paths in
 * `api.config.get` while the host builds candidates from the workspace path, and on macOS `/tmp` and `/var/folders`
 * are symlinks, so both sides must be canonical before they are compared.
 */
export async function canonicalPath(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch {
    try {
      return path.join(await realpath(path.dirname(file)), path.basename(file))
    } catch {
      return file
    }
  }
}
