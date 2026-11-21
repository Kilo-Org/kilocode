/**
 * PATH lookups for tool executables. Case-insensitive on Windows, where the
 * environment usually calls the variable `Path` rather than `PATH`.
 */

import { constants } from "node:fs"
import * as fs from "node:fs/promises"
import * as path from "node:path"

/** Read an environment variable by name, matching case on Windows. */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return env[name]
  const key = Object.keys(env).find((item) => item.toUpperCase() === name.toUpperCase())
  return key ? env[key] : undefined
}

/** First PATH entry that contains an executable regular file named `name`. */
export async function lookup(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const dirs = (envValue(env, "PATH", platform) ?? "").split(path.delimiter).filter(Boolean)
  const exts = platform === "win32" ? (envValue(env, "PATHEXT", platform) ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""]
  const mode = platform === "win32" ? constants.F_OK : constants.X_OK
  for (const file of dirs.flatMap((dir) => exts.map((ext) => path.join(dir, `${name}${ext}`)))) {
    const info = await fs.stat(file).catch(() => undefined)
    if (
      info?.isFile() &&
      (await fs.access(file, mode).then(
        () => true,
        () => false,
      ))
    )
      return file
  }
  return undefined
}
