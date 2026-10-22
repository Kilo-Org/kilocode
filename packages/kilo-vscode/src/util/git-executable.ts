import { constants } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { exec } from "./process"

export type GitExecutable = () => Promise<string>

interface GitExecutableOptions {
  platform?: NodeJS.Platform
  path?: string
  run?: (cmd: string, args: string[]) => Promise<{ stdout: string }>
  access?: (file: string, mode: number) => Promise<void>
  realpath?: (file: string) => Promise<string>
  preferred?: () => Promise<string | undefined>
  timeout?: number
  log?: (message: string) => void
}

/**
 * Preserve normal PATH lookup on every platform. On macOS only, bypass Apple's
 * /usr/bin/git launcher after confirming it is the command PATH would select and
 * xcrun identifies a valid executable for the active developer directory.
 */
export function createGitExecutable(options: GitExecutableOptions = {}): GitExecutable {
  const platform = options.platform ?? process.platform
  const run = options.run ?? ((cmd, args) => exec(cmd, args, { timeout: 15_000 }))
  const access = options.access ?? fs.access
  const realpath = options.realpath ?? fs.realpath
  const log = options.log ?? (() => undefined)
  let cached: Promise<string> | undefined

  return (): Promise<string> => {
    cached ??= (async () => {
      if (platform === "win32") {
        const timeout = options.timeout ?? 3_000
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return (
            (await Promise.race([
              options.preferred?.(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  reject(new Error(`VS Code Git activation timed out after ${timeout}ms`))
                }, timeout)
              }),
            ])) ?? "git"
          )
        } catch (err) {
          log(`Unable to resolve the preferred Git executable, using PATH: ${err}`)
          return "git"
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      }
      if (platform !== "darwin") return "git"

      try {
        const env = options.path ?? process.env.PATH ?? "/usr/bin:/bin"
        const selected = await (async () => {
          for (const dir of env.split(path.posix.delimiter)) {
            // Relative and empty PATH entries depend on each command's cwd, so
            // they cannot be resolved once without changing lookup semantics.
            if (!dir || !path.posix.isAbsolute(dir)) return undefined
            const file = path.posix.join(dir, "git")
            const resolved = await access(file, constants.X_OK)
              .then(() => realpath(file))
              .catch(() => undefined)
            if (resolved) return resolved
          }
          return undefined
        })()
        if (selected !== "/usr/bin/git") return "git"

        const result = await run("/usr/bin/xcrun", ["--find", "git"])
        const candidate = result.stdout.trim()
        if (!candidate || candidate === selected || !path.posix.isAbsolute(candidate)) return "git"
        if (!/^[/a-zA-Z0-9._~-]+$/.test(candidate)) return "git"

        await access(candidate, constants.X_OK)
        const version = await run(candidate, ["--version"])
        if (!version.stdout.trim().startsWith("git version ")) return "git"

        log(`Using ${candidate} directly instead of the macOS Git launcher`)
        return candidate
      } catch (err) {
        log(`Unable to bypass the macOS Git launcher, using PATH: ${err}`)
        return "git"
      }
    })()

    return cached
  }
}
