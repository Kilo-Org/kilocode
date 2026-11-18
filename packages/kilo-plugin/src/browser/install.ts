import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Global } from "@opencode/util/global"

/** The parts of playwright-core's browser registry this CLI drives; the package publishes no declarations for them. */
type Executable = {
  name: string
  /** `<browsers dir>/chromium-<revision>`: where the archive is extracted. */
  directory: string
  /** Archive URLs for this host, in preference order. */
  downloadURLs: readonly string[]
  /** Absolute path of the executable inside `directory`, which may not exist yet. */
  executablePath(): string | undefined
}

type Registry = { findExecutable(name: string): unknown }
type Utils = { extractZip(zipPath: string, options: { dir: string }): Promise<void> }

/**
 * The bundled build re-exports the registry module as CommonJS, and its interop nests the values under the module's
 * own keys, so each shape is found rather than assumed.
 */
function found<K extends string>(value: unknown, key: K): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined
  return (value as Record<K, unknown>)[key]
}

function registryOf(value: unknown): Registry | undefined {
  if (typeof found(value, "findExecutable") !== "function") {
    const nested = found(value, "registry")
    return nested === value ? undefined : registryOf(nested)
  }
  return value as Registry
}

function utilsOf(value: unknown): Utils | undefined {
  const utils = found(value, "utils") ?? value
  if (typeof found(utils, "extractZip") !== "function") return undefined
  return utils as Utils
}

function executableOf(value: unknown): Executable | undefined {
  const directory = found(value, "directory")
  const urls = found(value, "downloadURLs")
  if (typeof directory !== "string" || !Array.isArray(urls) || typeof found(value, "executablePath") !== "function")
    return undefined
  if (!urls.every((url) => typeof url === "string")) return undefined
  return value as Executable
}

/**
 * The Chromium build of the bundled playwright-core lives in the Kilo data dir, not in Playwright's shared cache:
 * uninstalling Kilo removes it, and a Kilo update never adopts a browser another tool installed.
 */
export function browsersDirectory() {
  return path.join(Global.Path.data, "browser", "browsers")
}

/**
 * playwright-core resolves its browser directory once, when its registry module initializes, so this must run before
 * the first import of `playwright-core` in the process.
 */
export function useKiloBrowsers() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDirectory()
}

/**
 * Extract an archive into a sibling staging directory, verify the browser executable is there, and only then replace
 * the installed directory. A failed or interrupted extraction leaves the working browser untouched.
 */
export async function installArchive(input: {
  directory: string
  archive: string
  extract: (zip: string, options: { dir: string }) => Promise<void>
  executable: string
  /** The move into place; a test can make it fail to prove the rollback. */
  swap?: (from: string, to: string) => Promise<void>
}): Promise<string> {
  const staging = `${input.directory}.staging-${process.pid}`
  const backup = `${input.directory}.backup-${process.pid}`
  const relative = path.relative(input.directory, input.executable)
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  // A backup from an install that was killed keeps its browser; the next install starts from a clean name.
  await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
  try {
    await input.extract(input.archive, { dir: staging })
    const staged = path.join(staging, relative)
    const found = await fs.stat(staged).catch(() => undefined)
    if (!found?.isFile()) throw new Error("The Chromium archive did not contain the browser executable.")
    await fs.chmod(staged, 0o755)
    // The marker is what playwright-core's own installer checks before it downloads again.
    await fs.writeFile(path.join(staging, "INSTALLATION_COMPLETE"), "")
    // Move the old install aside, put the verified one in place, and only then drop the old copy. If the move into
    // place fails, the old directory is restored and the real error is what the caller sees.
    const moved = await fs.rename(input.directory, backup).then(
      () => true,
      () => false,
    )
    try {
      await (input.swap ?? fs.rename)(staging, input.directory)
    } catch (error) {
      if (moved) await fs.rename(backup, input.directory).catch(() => undefined)
      throw error
    }
    if (moved) await fs.rm(backup, { recursive: true, force: true })
    return path.join(input.directory, relative)
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

/**
 * Download the Chromium build this playwright-core pins into the Kilo data dir, then extract it with the zip reader
 * that ships inside playwright-core. The registry's own installer is unusable here: it forks a Node entry file through
 * `process.execPath`, which in the compiled CLI is the CLI itself.
 */
export async function installChromium(options: { force?: boolean } = {}) {
  useKiloBrowsers()
  // Dynamic: the module below reads the environment above at import time, and only the install command needs it.
  // @ts-expect-error -- the published subpath has no type declarations (the shapes are found by the helpers above).
  const module: unknown = await import("playwright-core/lib/coreBundle")
  const registry = registryOf(found(module, "registry") ?? module)
  if (!registry) throw new Error("The bundled playwright-core exposes no browser registry.")
  const executable = executableOf(registry.findExecutable("chromium"))
  if (!executable) throw new Error("The bundled playwright-core has no Chromium build for this platform.")
  const utils = utilsOf(module)
  if (!utils) throw new Error("The bundled playwright-core exposes no zip reader.")
  const urls = executable.downloadURLs
  if (!urls.length) throw new Error("The bundled playwright-core lists no Chromium download for this platform.")

  const target = executable.executablePath()
  const installed = target ? await fs.stat(target).catch(() => undefined) : undefined
  if (!options.force && target && installed?.isFile())
    return { executable: target, directory: executable.directory, changed: false }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-chromium-"))
  const zip = path.join(directory, "chromium.zip")
  try {
    let failure: unknown
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
        const handle = await fs.open(zip, "w")
        try {
          for await (const chunk of response.body ?? []) await handle.write(chunk)
        } finally {
          await handle.close()
        }
        failure = undefined
        break
      } catch (error) {
        failure = error
        await fs.rm(zip, { force: true })
      }
    }
    if (failure !== undefined)
      throw new Error(
        `Could not download Chromium from ${urls.join(", ")}: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
    const expected = executable.executablePath()
    if (!expected) throw new Error("The Chromium archive did not contain the browser executable.")
    const binary = await installArchive({
      directory: executable.directory,
      archive: zip,
      extract: (archive, options) => utils.extractZip(archive, options),
      executable: expected,
    })
    return { executable: binary, directory: executable.directory, changed: true }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
