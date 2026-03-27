import os from "os"
import path from "path"

type PathModule = Pick<typeof path, "join" | "normalize">

interface XdgEnv {
  data?: string
  cache?: string
  config?: string
  state?: string
}

function baseDir(value: string | undefined, home: string, fallback: string[], pathmod: PathModule) {
  if (value) return pathmod.normalize(value)
  return pathmod.normalize(pathmod.join(home, ...fallback))
}

export function resolveHome(home = process.env.KILO_TEST_HOME || os.homedir()) {
  return home
}

export function resolveGlobalPaths(
  app: string,
  opts: {
    home?: string
    env?: XdgEnv
    pathmod?: PathModule
  } = {},
) {
  const home = resolveHome(opts.home)
  const pathmod = opts.pathmod ?? path
  const env = opts.env ?? {
    data: process.env["XDG_DATA_HOME"],
    cache: process.env["XDG_CACHE_HOME"],
    config: process.env["XDG_CONFIG_HOME"],
    state: process.env["XDG_STATE_HOME"],
  }

  const dataRoot = baseDir(env.data, home, [".local", "share"], pathmod)
  const cacheRoot = baseDir(env.cache, home, [".cache"], pathmod)
  const configRoot = baseDir(env.config, home, [".config"], pathmod)
  const stateRoot = baseDir(env.state, home, [".local", "state"], pathmod)

  const data = pathmod.join(dataRoot, app)
  const cache = pathmod.join(cacheRoot, app)
  const config = pathmod.join(configRoot, app)
  const state = pathmod.join(stateRoot, app)

  return {
    home,
    data,
    bin: pathmod.join(data, "bin"),
    log: pathmod.join(data, "log"),
    cache,
    config,
    state,
  }
}

export function expandHomePattern(pattern: string, home = resolveHome(), pathmod: PathModule = path) {
  if (pattern === "~" || pattern === "$HOME") return home
  if (pattern.startsWith("~/")) return pathmod.join(home, pattern.slice(2))
  if (pattern.startsWith("$HOME/")) return pathmod.join(home, pattern.slice(6))
  return pattern
}
