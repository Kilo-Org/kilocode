import os from "node:os"
import path from "node:path"
import { KiloGlobalResilience } from "./global-resilience"
import { directory } from "./env"

// Host boot step (rung 2): the entry imports this before any @opencode/util/global load. util/global
// computes Global.Path from the XDG environment at module load and is read statically by logging, the
// server tmp and the TUI, so path-affecting resilience must run here (env), not via a service layer.
// It resolves a writable state directory, then repairs and Spotlight-marks the Kilo directories,
// leaving util/global pristine. Every process the host starts runs this first (through the entry).

KiloGlobalResilience.cleanEnv(process.env)
// roots() in util/global resolves the XDG bases with `||`, so an empty or whitespace-only XDG_STATE_HOME
// (the shell-newline case this feature targets, after cleanEnv strips the newline) falls through to the
// default like an unset value. Mirror that here with `||` and treat a now-empty XDG_STATE_HOME as unset so
// `preferred` never becomes a relative CWD path and the v1 data-nested fallback still applies.
const hadStateHome = (process.env.XDG_STATE_HOME ?? "") !== ""

// os.homedir() caches a dirty $HOME (with a shell newline) from process start, and util/global's roots()
// defaults its XDG bases from os.homedir(). cleanEnv only strips process.env.HOME, which roots() does not
// read, so pin each unset XDG base to the cleaned home here. roots() then reads these clean values from the
// environment via `||` and never reaches its cached os.homedir() default, keeping util/global pristine.
const home = KiloGlobalResilience.resolveHome(process.env, os.homedir())
process.env.XDG_DATA_HOME = process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(home, ".cache")
process.env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
const stateBase = process.env.XDG_STATE_HOME || path.join(home, ".local", "state")
const dataBase = process.env.XDG_DATA_HOME
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
// Repair every leaf that util/global's acquire mkdirs and realpaths, so a dangling symlink/junction at any
// of them is healed before the Global service runs (v1 repaired data/config/tmp/log/bin/repos).
await Promise.all(
  [
    Global.Path.data,
    config,
    Global.Path.state,
    Global.Path.cache,
    Global.Path.tmp,
    Global.Path.log,
    Global.Path.bin,
    Global.Path.repos,
  ].map(KiloGlobalResilience.ensureRealDir),
)
await Promise.all([Global.Path.data, Global.Path.cache, Global.Path.state].map(KiloGlobalResilience.markNoIndex))
