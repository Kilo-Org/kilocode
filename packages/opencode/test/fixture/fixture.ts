import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"
import { Filesystem } from "../../src/util/filesystem"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

type TmpDirOptions<T> = {
  git?: boolean
  config?: Partial<Config.Info>
  init?: (dir: string) => Promise<T>
  dispose?: (dir: string) => Promise<T>
}
export async function tmpdir<T>(options?: TmpDirOptions<T>) {
  const dirpath = sanitizePath(path.join(os.tmpdir(), "opencode-test-" + Math.random().toString(36).slice(2)))
  await fs.mkdir(dirpath, { recursive: true })
  if (options?.git) {
    // kilocode_change - improve error handling for git init
    const initResult = await $`git init`.cwd(dirpath).quiet().nothrow()
    if (initResult.exitCode !== 0) {
      throw new Error(`git init failed: ${initResult.stderr}`)
    }
    const commitResult = await $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).quiet().nothrow()
    if (commitResult.exitCode !== 0) {
      throw new Error(`git commit failed: ${commitResult.stderr}`)
    }
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://app.kilo.ai/config.json",
        ...options.config,
      }),
    )
  }
  const extra = await options?.init?.(dirpath)
  // kilocode_change - use Filesystem.normalize for realpath
  const realpath = Filesystem.normalize(sanitizePath(await fs.realpath(dirpath)))
  const result = {
    [Symbol.asyncDispose]: async () => {
      await options?.dispose?.(dirpath)
      // await fs.rm(dirpath, { recursive: true, force: true })
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}
