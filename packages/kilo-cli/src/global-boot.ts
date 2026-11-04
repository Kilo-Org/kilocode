import os from "node:os"
import path from "node:path"
import { KiloGlobalResilience } from "./global-resilience"
import { directory } from "./env"

// Host boot step (rung 2): the entry imports this before any @opencode/util/global load. util/global
// computes Global.Path from the XDG environment at module load and is read statically by logging, the
// server tmp and the TUI, so path-affecting resilience must run here (env), not via a service layer.
// It resolves a writable state directory, then repairs and Spotlight-marks the Kilo directories,
// leaving util/global pristine. Every process the host starts runs this first (through the entry).

const hadStateHome = process.env.XDG_STATE_HOME !== undefined
KiloGlobalResilience.cleanEnv(process.env)

const home = os.homedir()
const stateBase = process.env.XDG_STATE_HOME ?? path.join(home, ".local", "state")
const dataBase = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
const data = path.join(dataBase, directory)
const preferred = path.join(stateBase, directory)
// roots() in util/global always appends the app name, so the fallback state directory is <data>/<app>
// (a writable state directory nested under data), not v1's literal <data>/state. Only used when
// XDG_STATE_HOME is unset, mirroring v1.
const resolved = await KiloGlobalResilience.resolveState(
  preferred,
  hadStateHome ? undefined : path.join(data, directory),
)
process.env.XDG_STATE_HOME = resolved === preferred ? stateBase : data

const { Global } = await import("@opencode/util/global")
const config = process.env.OPENCODE_CONFIG_DIR ?? Global.Path.config
await Promise.all(
  [Global.Path.data, config, Global.Path.state, Global.Path.cache].map(KiloGlobalResilience.ensureRealDir),
)
await Promise.all([Global.Path.data, Global.Path.cache, Global.Path.state].map(KiloGlobalResilience.markNoIndex))
