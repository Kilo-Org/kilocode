import { $ } from "bun"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import type { Config } from "../../src/config/config"

// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}

function exists(dir: string) {
  return fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)
}

function clean(dir: string) {
  return fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  })
}

async function stop(dir: string) {
  if (!(await exists(dir))) return
  try {
    await $`git fsmonitor--daemon stop`.cwd(dir).quiet().nothrow()
  } catch {
    // Ignore errors — the directory may have been removed between the exists check
    // and the shell command execution (TOCTOU race on Windows).
  }
}

// On Windows, fs.mkdir can return before the directory is fully visible to
// child processes. Verify the directory exists before proceeding.
async function ensureDir(dir: string, retries = 5): Promise<void> {
  for (let i = 0; i < retries; i++) {
    if (await exists(dir)) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

// Run a shell command with retry logic for Windows filesystem races (ENOENT/EBUSY).
async function shellRetry(cmd: () => ReturnType<typeof $>, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await cmd()
      return
    } catch (err: any) {
      const code = err?.code ?? err?.info?.code
      if ((code === "ENOENT" || code === "EBUSY") && i < retries - 1) {
        await new Promise((r) => setTimeout(r, 100 * (i + 1)))
        continue
      }
      throw err
    }
  }
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
  await ensureDir(dirpath)
  if (options?.git) {
    await shellRetry(() => $`git init`.cwd(dirpath).quiet())
    await shellRetry(() => $`git config core.fsmonitor false`.cwd(dirpath).quiet())
    await shellRetry(() => $`git commit --allow-empty -m "root commit ${dirpath}"`.cwd(dirpath).quiet())
  }
  if (options?.config) {
    await Bun.write(
      path.join(dirpath, "opencode.json"),
      JSON.stringify({
        $schema: "https://app.devil.ai/config.json",
        ...options.config,
      }),
    )
  }
  const realpath = sanitizePath(await fs.realpath(dirpath))
  const extra = await options?.init?.(realpath)
  const result = {
    [Symbol.asyncDispose]: async () => {
      try {
        await options?.dispose?.(realpath)
      } catch {
        // ignore dispose callback errors
      }
      try {
        if (options?.git) await stop(realpath).catch(() => undefined)
        // Brief delay to allow background git/shell processes to finish
        // before removing the directory. On Windows, processes spawned
        // during Instance.provide may still hold handles on the temp dir.
        if (process.platform === "win32") {
          await new Promise((r) => setTimeout(r, 100))
        }
        await clean(realpath).catch(() => undefined)
      } catch {
        // ignore cleanup errors — on Windows, git processes may hold handles
      }
    },
    path: realpath,
    extra: extra as T,
  }
  return result
}
