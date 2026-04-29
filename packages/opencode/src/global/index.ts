import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util"
import { Flock } from "@opencode-ai/shared/util/flock"

const app = process.env.KILO_DEV ? "kilo-dev" : "kilo" // kilocode_change

// kilocode_change start
// Defensively strip surrounding whitespace from the resolved XDG paths.
// If `$HOME` (or any `$XDG_*_HOME` override) has a trailing newline in
// the user's shell — e.g. because a shell snippet did `export HOME=$(cmd)`
// against a command with an implicit newline — the unsanitised path
// makes `fs.mkdir` try to create `/Users/<name>\n` and fail with EACCES,
// which breaks every `kilo` invocation at startup (including the SDK
// regen that runs during `bun run extension`). A trim is cheap and
// trailing whitespace is never legitimate in a filesystem path.
const clean = (p: string | undefined) => p?.trim()
const data = clean(process.env.KILO_DATA_DIR) ?? path.join(clean(xdgData)!, app)
const cache = clean(process.env.KILO_CACHE_DIR) ?? path.join(clean(xdgCache)!, app)
const config = clean(process.env.KILO_GLOBAL_CONFIG_DIR) ?? path.join(clean(xdgConfig)!, app)
const state = clean(process.env.KILO_STATE_DIR) ?? path.join(clean(xdgState)!, app)
// kilocode_change end

export const Path = {
  // Allow override via KILO_TEST_HOME for test isolation
  get home() {
    return (process.env.KILO_TEST_HOME || os.homedir()).trim() // kilocode_change — defensive trim, see above
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  cache,
  config,
  state,
}

// Initialize Flock with global state path
Flock.setGlobal({ state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Filesystem.readText(path.join(Path.cache, "version")).catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch {}
  await Filesystem.write(path.join(Path.cache, "version"), CACHE_VERSION)
}

export * as Global from "."
