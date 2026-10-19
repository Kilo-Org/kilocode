// Keep the tests out of the real home: the global paths are read when the core modules load, so they point at a
// fresh directory before any test imports them, as script/startup.ts does for the startup ratchet.
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const home = mkdtempSync(path.join(os.tmpdir(), "kilo-cli-test-"))
process.env.OPENCODE_TEST_HOME = home
process.env.XDG_DATA_HOME = path.join(home, "data")
process.env.XDG_CONFIG_HOME = path.join(home, "config")
process.env.XDG_STATE_HOME = path.join(home, "state")
process.env.XDG_CACHE_HOME = path.join(home, "cache")
process.once("exit", () => rmSync(home, { recursive: true, force: true }))
