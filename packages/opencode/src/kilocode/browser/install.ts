// Native messaging host install: a stable shim that re-runs this CLI, plus the host
// manifests and (on Windows) the HKCU registry keys the browsers read.
import path from "path"
import fs from "fs/promises"
import { Log } from "@opencode-ai/core/util/log"
import { Process } from "@/util/process"
import { FirefoxExtensionId, ExtensionId, HostName, StoreExtensionId } from "./protocol"
import { Paths } from "./paths"
import { bin } from "./bin"

const log = Log.create({ service: "browser.install" })

export function ids(env: NodeJS.ProcessEnv = process.env) {
  const extra = (env.KILO_BROWSER_EXTRA_EXTENSION_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return [...new Set([StoreExtensionId, ...extra])].filter((item) => ExtensionId.safeParse(item).success)
}

export function allowlistPath(data = Paths.data()) {
  return path.join(data, "allowed.json")
}

// The manifests are written from the installing shell, but the browser starts the
// host from its GUI session, which does not inherit KILO_BROWSER_EXTRA_EXTENSION_IDS.
// Persisting the list next to the manifests keeps the runtime check in step with them.
export async function allowlist(data = Paths.data()) {
  const text = await fs.readFile(allowlistPath(data), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    log.warn("the installed allowlist is not valid JSON", { error })
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && ExtensionId.safeParse(item).success)
}

// The browser passes the calling origin (Chrome) or the manifest path and add-on ID
// (Firefox). A host started by hand passes neither and is allowed.
export function caller(args: string[], allowed: string[]) {
  for (const arg of args) {
    const origin = /^chrome-extension:\/\/([a-p]{32})\/?$/.exec(arg)
    if (origin) return origin[1] !== undefined && allowed.includes(origin[1])
    if (arg === FirefoxExtensionId) return true
  }
  return true
}

export type Kind = "chromium" | "firefox"

export type Target = {
  browser: string
  kind: Kind
  file: string
  // HKCU key whose default value points at `file`; only set on Windows.
  key?: string
}

export type Layout = {
  platform: NodeJS.Platform
  home: string
  // XDG config home, i.e. the parent of `google-chrome` on Linux.
  config: string
  data: string
}

// `dir` is the macOS user-data directory, `linux` the XDG config directory, and
// `key` the HKCU root on Windows.
type Browser = { name: string; dir: string; linux: string; key: string }

const chromium: Browser[] = [
  { name: "Chrome", dir: "Google/Chrome", linux: "google-chrome", key: "Google\\Chrome" },
  { name: "Chrome Beta", dir: "Google/Chrome Beta", linux: "google-chrome-beta", key: "Google\\Chrome Beta" },
  {
    name: "Chrome Canary",
    dir: "Google/Chrome Canary",
    linux: "google-chrome-unstable",
    key: "Google\\Chrome SxS",
  },
  { name: "Chromium", dir: "Chromium", linux: "chromium", key: "Chromium" },
  { name: "Edge", dir: "Microsoft Edge", linux: "microsoft-edge", key: "Microsoft\\Edge" },
  {
    name: "Brave",
    dir: "BraveSoftware/Brave-Browser",
    linux: "BraveSoftware/Brave-Browser",
    key: "BraveSoftware\\Brave-Browser",
  },
  // Arc, Vivaldi and Opera are not documented by Google; their user-data directories
  // are inferred from the products' own naming.
  { name: "Arc", dir: "Arc/User Data", linux: "Arc/User Data", key: "Arc" },
  { name: "Vivaldi", dir: "Vivaldi", linux: "vivaldi", key: "Vivaldi" },
  { name: "Opera", dir: "com.operasoftware.Opera", linux: "opera", key: "Opera Software" },
]

const fileName = `${HostName}.json`

export function targets(input: Layout): Target[] {
  const list: Target[] = []
  const base =
    input.platform === "darwin"
      ? path.join(input.home, "Library/Application Support")
      : input.platform === "linux"
        ? input.config
        : undefined

  if (input.platform === "win32") {
    for (const browser of chromium) {
      list.push({
        browser: browser.name,
        kind: "chromium",
        file: path.join(input.data, "manifests", "chromium", `${browser.name}.json`),
        key: `HKCU\\Software\\${browser.key}\\NativeMessagingHosts\\${HostName}`,
      })
    }
    list.push({
      browser: "Firefox",
      kind: "firefox",
      file: path.join(input.data, "manifests", "firefox", fileName),
      key: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HostName}`,
    })
    return list
  }

  if (!base) return list

  if (input.platform === "linux") {
    for (const browser of chromium) {
      list.push({
        browser: browser.name,
        kind: "chromium",
        file: path.join(base, browser.linux, "NativeMessagingHosts", fileName),
      })
    }
    list.push({
      browser: "Firefox",
      kind: "firefox",
      file: path.join(input.home, ".mozilla/native-messaging-hosts", fileName),
    })
    // Firefox from the Ubuntu snap reads its own profile tree.
    list.push({
      browser: "Firefox (snap)",
      kind: "firefox",
      file: path.join(input.home, "snap/firefox/common/.mozilla/native-messaging-hosts", fileName),
    })
    return list
  }

  for (const browser of chromium) {
    list.push({
      browser: browser.name,
      kind: "chromium",
      file: path.join(base, browser.dir, "NativeMessagingHosts", fileName),
    })
  }
  list.push({ browser: "Firefox", kind: "firefox", file: path.join(base, "Mozilla/NativeMessagingHosts", fileName) })
  return list
}

export function manifest(input: { kind: Kind; target: string; allowed: string[] }) {
  if (input.kind === "firefox") {
    return {
      name: HostName,
      description: "Kilo browser bridge",
      path: input.target,
      type: "stdio",
      allowed_extensions: [FirefoxExtensionId],
    }
  }
  return {
    name: HostName,
    description: "Kilo browser bridge",
    path: input.target,
    type: "stdio",
    allowed_origins: input.allowed.map((id) => `chrome-extension://${id}/`),
  }
}

export function script(input: { platform: NodeJS.Platform; command: string[] }) {
  const cmd = input.command.map((part) => `"${part.replaceAll('"', '\\"')}"`)
  if (input.platform === "win32") return `@echo off\r\n${cmd.join(" ")} browser-hub --native %*\r\n`
  return `#!/bin/sh\n# Generated by Kilo: the browser runs this file as its native messaging host.\nexec ${cmd.join(" ")} browser-hub --native "$@"\n`
}

async function write(file: string, content: string, mode: number) {
  const current = await fs.readFile(file, "utf8").catch(() => undefined)
  // Idempotent: rewrite only when the bytes differ, so repeated installs are quiet.
  if (current !== content) await fs.writeFile(file, content, { mode })
  await fs.chmod(file, mode)
}

export type Install = Partial<Layout> & {
  command?: string[]
  env?: NodeJS.ProcessEnv
  exec?: (cmd: string[]) => Promise<void>
}

export type Installed = {
  shim: string
  files: string[]
  keys: string[]
}

export async function install(input: Install = {}): Promise<Installed> {
  const platform = input.platform ?? process.platform
  const data = input.data ?? Paths.data()
  const home = input.home ?? process.env.HOME ?? process.env.USERPROFILE ?? ""
  const config = input.config ?? process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  const command = input.command ?? bin()
  const run =
    input.exec ??
    (async (cmd: string[]) => {
      const result = await Process.run(cmd, { nothrow: true })
      if (result.code !== 0) throw new Error(`${cmd[0]} failed: ${result.stderr.toString().trim()}`)
    })

  await Paths.ensure(data)
  const shim = path.join(data, platform === "win32" ? "host.cmd" : "host")
  await write(shim, script({ platform, command }), 0o755)

  const allowed = ids(input.env)
  // A stale allowlist from an older install must not keep admitting an ID that the
  // freshly written manifests no longer list, so rewrite it with the same list.
  await write(allowlistPath(data), `${JSON.stringify(allowed, null, 2)}\n`, 0o600)
  const files: string[] = []
  const keys: string[] = []
  for (const target of targets({ platform, home, config, data })) {
    await fs.mkdir(path.dirname(target.file), { recursive: true })
    const body = manifest({ kind: target.kind, target: shim, allowed })
    await write(target.file, `${JSON.stringify(body, null, 2)}\n`, 0o644)
    files.push(target.file)
    if (!target.key) continue
    await run(["reg.exe", "add", target.key, "/ve", "/t", "REG_SZ", "/d", target.file, "/f"])
    keys.push(target.key)
  }

  log.info("installed the native messaging host", { shim, files: files.length, keys: keys.length })
  return { shim, files, keys }
}
