import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Process } from "@/util/process"
import { arch, homedir } from "node:os"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { PlatformError } from "./domain"

export interface Info {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly home: string
  readonly env: NodeJS.ProcessEnv
}

export interface Installation {
  readonly path: string
}

export interface Interface {
  readonly info: Info
  readonly dataDir: () => Effect.Effect<string, PlatformError>
  readonly installation: () => Effect.Effect<Installation | undefined, PlatformError>
  readonly open: () => Effect.Effect<void, PlatformError>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/AnacondaDesktopPlatform") {}

function value(info: Info, key: string) {
  const direct = info.env[key]
  if (direct) return direct
  const found = Object.entries(info.env).find(([name, item]) => name.toLowerCase() === key.toLowerCase() && item)
  return found?.[1]
}

export function supported(info: Pick<Info, "platform" | "arch">) {
  if (info.platform === "darwin") return info.arch === "arm64"
  if (info.platform === "win32") return info.arch === "x64"
  if (info.platform === "linux") return info.arch === "x64" || info.arch === "arm64"
  return false
}

export function directory(info: Info) {
  if (info.platform === "darwin")
    return path.posix.join(info.home, "Library", "Application Support", "anaconda-desktop")
  if (info.platform === "win32") {
    const root =
      value(info, "APPDATA") ?? path.win32.join(value(info, "USERPROFILE") ?? info.home, "AppData", "Roaming")
    return path.win32.join(root, "anaconda-desktop")
  }
  if (info.platform === "linux") {
    const root = value(info, "XDG_DATA_HOME") ?? path.posix.join(info.home, ".local", "share")
    return path.posix.join(root, "anaconda-desktop")
  }
}

export function candidates(info: Info) {
  if (info.platform === "darwin") {
    return [
      "/Applications/Anaconda Desktop.app",
      path.posix.join(info.home, "Applications", "Anaconda Desktop.app"),
    ]
  }

  if (info.platform === "win32") {
    const local = value(info, "LOCALAPPDATA") ?? path.win32.join(info.home, "AppData", "Local")
    const program = value(info, "ProgramFiles") ?? "C:\\Program Files"
    const x86 = value(info, "ProgramFiles(x86)")
    return [
      path.win32.join(local, "Programs", "Anaconda Desktop", "Anaconda Desktop.exe"),
      path.win32.join(local, "anaconda-desktop", "Anaconda Desktop.exe"),
      path.win32.join(program, "Anaconda Desktop", "Anaconda Desktop.exe"),
      ...(x86 ? [path.win32.join(x86, "Anaconda Desktop", "Anaconda Desktop.exe")] : []),
    ]
  }

  if (info.platform === "linux") {
    const env = value(info, "PATH")?.split(path.posix.delimiter).filter(Boolean) ?? []
    return [
      ...env.map((dir) => path.posix.join(dir, "anaconda-desktop")),
      "/usr/bin/anaconda-desktop",
      "/usr/local/bin/anaconda-desktop",
      path.posix.join(info.home, ".local", "bin", "anaconda-desktop"),
    ]
  }

  return []
}

export function command(info: Info, install: Installation) {
  if (info.platform === "darwin") return ["/usr/bin/open", install.path]
  if (info.platform === "win32") return [install.path]
  if (info.platform === "linux") {
    const wayland = value(info, "XDG_SESSION_TYPE")?.toLowerCase() === "wayland" || !!value(info, "WAYLAND_DISPLAY")
    return [install.path, ...(wayland ? ["--ozone-platform=x11"] : [])]
  }
}

const variables = [
  "APPDATA",
  "ComSpec",
  "DBUS_SESSION_BUS_ADDRESS",
  "DESKTOP_SESSION",
  "DISPLAY",
  "GDMSESSION",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CURRENT_DESKTOP",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "XDG_SESSION_TYPE",
] as const

export function environment(info: Info): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(info.env).map((key) => [key, undefined]))
  for (const key of variables) {
    const item = value(info, key)
    if (item) env[key] = item
  }
  if (info.platform === "win32") env.USERPROFILE ??= info.home
  else env.HOME ??= info.home
  return env
}

function current(): Info {
  return {
    platform: process.platform,
    arch: arch(),
    home: homedir(),
    env: process.env,
  }
}

export function makeLayer(info: Info) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service

      const dataDir = Effect.fn("AnacondaDesktopPlatform.dataDir")(function* () {
        const dir = directory(info)
        if (dir) return dir
        return yield* new PlatformError({ operation: "data-dir", reason: "unsupported" })
      })

      const installation = Effect.fn("AnacondaDesktopPlatform.installation")(function* () {
        if (!supported(info)) {
          return yield* new PlatformError({ operation: "installation", reason: "unsupported" })
        }
        for (const candidate of candidates(info)) {
          if (yield* fs.existsSafe(candidate)) return { path: candidate }
        }
        return undefined
      })

      const open = Effect.fn("AnacondaDesktopPlatform.open")(function* () {
        const install = yield* installation()
        if (!install) return yield* new PlatformError({ operation: "open", reason: "not-installed" })
        const cmd = command(info, install)
        if (!cmd) return yield* new PlatformError({ operation: "open", reason: "unsupported" })
        const child = yield* Effect.try({
          try: () => Process.spawn(cmd, { env: environment(info) }),
          catch: () => new PlatformError({ operation: "open", reason: "failed" }),
        })
        yield* Effect.callback<void, PlatformError>((resume) => {
          const done = () => {
            child.removeListener("error", fail)
            child.unref()
            resume(Effect.void)
          }
          const fail = () => {
            child.removeListener("spawn", done)
            resume(Effect.fail(new PlatformError({ operation: "open", reason: "failed" })))
          }
          child.once("spawn", done)
          child.once("error", fail)
          return Effect.sync(() => {
            child.removeListener("spawn", done)
            child.removeListener("error", fail)
          })
        })
      })

      return Service.of({ info, dataDir, installation, open })
    }),
  )
}

export const layer = makeLayer(current())
export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))
