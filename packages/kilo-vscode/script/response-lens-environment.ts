import { delimiter, dirname, join, parse, resolve } from "node:path"

export function environment(root: string, compiler: string, version: string, input: NodeJS.ProcessEnv = process.env) {
  const home = resolve(root, "home")
  const drive = parse(home).root
  const keys = [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "ProgramFiles",
    "PROGRAMFILES",
    "ProgramFiles(x86)",
  ]
  const safe = Object.fromEntries(keys.flatMap((key) => (input[key] ? [[key, input[key]!]] : [])))
  return {
    ...safe,
    PATH: dirname(compiler) + delimiter + (input.PATH ?? input.Path ?? ""),
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: process.platform === "win32" ? drive.slice(0, 2) : "",
    HOMEPATH: process.platform === "win32" ? home.slice(2) : home,
    APPDATA: resolve(root, "roaming"),
    LOCALAPPDATA: resolve(root, "local"),
    TEMP: resolve(root, "tmp"),
    TMP: resolve(root, "tmp"),
    XDG_CONFIG_HOME: resolve(root, "config"),
    XDG_DATA_HOME: resolve(root, "data"),
    XDG_CACHE_HOME: resolve(root, "cache"),
    XDG_STATE_HOME: resolve(root, "state"),
    CODEX_HOME: resolve(root, "codex"),
    KILO_CONFIG_DIR: resolve(root, "config", "kilo"),
    KILO_DISABLE_PROJECT_CONFIG: "1",
    KILO_CONFIG_CONTENT: JSON.stringify({
      enabled_providers: [],
      mcp: {},
      autoupdate: false,
      share: "disabled",
      experimental: { openTelemetry: false },
    }),
    KILO_BUILD_BUN: compiler,
    KILO_VERSION: version,
    KILO_CHANNEL: "response-lens",
    KILO_LOCAL_PACKAGE: "1",
    KILO_RELEASE: "",
  }
}

export function directories(root: string) {
  return ["home", "roaming", "local", "tmp", "config/kilo", "data", "cache", "state", "codex"].map((entry) =>
    join(root, entry),
  )
}
