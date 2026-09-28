import * as vscode from "vscode"
import fs from "node:fs/promises"
import path from "node:path"
import { exec } from "../../util/process"
import { t } from "../i18n"
import { lines } from "./notice"
import type { AttentionNotice } from "./service"

type Command = {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char)
}

// libnotify parses the body as Pango markup, so an unescaped `<` or `&` in a
// workspace or session name can drop the notification or inject markup.
function pango(value: string) {
  return value.replace(/[&<>]/g, (char) => entities[char] ?? char)
}

function apple(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
}

function text(notice: AttentionNotice) {
  return lines(notice).join("\n")
}

/**
 * The AppUserModelID Windows uses to attribute the toast. Reading it from the
 * running host's `product.json` keeps Cursor, Antigravity, and other forks
 * working without a hardcoded editor-name mapping.
 */
export async function readAppID(root: string | undefined): Promise<string | undefined> {
  // `appRoot` is not guaranteed to be populated on every host.
  if (!root) return undefined
  const raw = await fs.readFile(path.join(root, "product.json"), "utf8").catch((err) => {
    console.debug("[Kilo New] could not read product.json for the notification identity", { root, err })
    return undefined
  })
  if (!raw) return undefined
  const parsed = ((): { win32AppUserModelId?: unknown } | undefined => {
    try {
      return JSON.parse(raw)
    } catch (err) {
      console.debug("[Kilo New] product.json is not valid JSON", { root, err })
      return undefined
    }
  })()
  const value = parsed?.win32AppUserModelId
  // Validate before use: a missing or malformed field must fail safely rather
  // than attribute the toast to the wrong application.
  if (typeof value !== "string") return undefined
  const appid = value.trim()
  if (!appid || appid.length > 256) return undefined
  if (/[\u0000-\u001f\u007f]/.test(appid)) return undefined
  return appid
}

let cached: Promise<string | undefined> | undefined

/** Cached per session; `appRoot` cannot change while the host is running. */
export function resolveAppID(platform = process.platform): Promise<string | undefined> {
  if (platform !== "win32") return Promise.resolve(undefined)
  cached ??= readAppID(vscode.env.appRoot)
  return cached
}

export function notificationCommand(
  notice: AttentionNotice,
  platform = process.platform,
  appid?: string,
): Command | undefined {
  if (platform === "win32") {
    // Without a verified identity Windows would either drop the toast or
    // attribute it to another editor, so decline instead of guessing.
    if (!appid) return undefined
    const xml = `<toast><visual><binding template="ToastGeneric"><text>${escape(notice.message)}</text>${notice.workspace ? `<text>${escape(t("kilocode:attention.workspace"))}: ${escape(notice.workspace)}</text>` : ""}${notice.session ? `<text>${escape(t("kilocode:attention.session"))}: ${escape(notice.session)}</text>` : ""}</binding></visual></toast>`
    // The XML and the identity are passed as environment data and never
    // interpolated into the script. XML escaping does not neutralize the
    // Unicode smart quotes (U+2018/U+2019) that PowerShell also accepts as
    // string delimiters, so a crafted session title could otherwise close the
    // string literal and run arbitrary commands. -EncodedCommand does not help,
    // as it encodes the already-composed source.
    const script = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null",
      "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
      "$xml.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:KILO_TOAST_XML)))",
      "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:KILO_TOAST_APPID).Show($toast)",
    ].join("; ")
    return {
      cmd: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      env: { KILO_TOAST_XML: Buffer.from(xml, "utf8").toString("base64"), KILO_TOAST_APPID: appid },
    }
  }
  if (platform === "darwin") {
    return { cmd: "osascript", args: ["-e", `display notification "${apple(text(notice))}" with title "Kilo Code"`] }
  }
  if (platform === "linux") {
    // Only the body is markup; the summary is taken literally.
    return { cmd: "notify-send", args: ["--app-name=Kilo Code", "--urgency=normal", "Kilo Code", pango(text(notice))] }
  }
}

let chain = Promise.resolve()
let queued = 0
const limit = 3
const timeout = 10_000

function run(command: Command) {
  // execFile replaces the environment wholesale, so keep the inherited one.
  return exec(command.cmd, command.args, {
    timeout,
    ...(command.env ? { env: { ...process.env, ...command.env } } : {}),
  })
}

/** Sends a real native notification and reports whether the underlying command succeeded. */
export async function testOSNotification(platform = process.platform): Promise<{ ok: boolean; error?: string }> {
  const notice = { message: t("kilocode:attention.test") }
  const appid = await resolveAppID(platform)
  const command = notificationCommand(notice, platform, appid)
  if (!command) {
    const reason = platform === "win32" ? "kilocode:attention.identity" : "kilocode:attention.unsupported"
    return { ok: false, error: t(reason) }
  }
  return run(command).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
}

export function showOSNotification(notice: AttentionNotice): void {
  if (queued >= limit) return
  queued += 1
  // Serialized with a small cap so bursts cannot pile up native helper processes.
  chain = chain
    .then(async () => {
      const command = notificationCommand(notice, process.platform, await resolveAppID())
      if (!command) return
      await run(command).then(
        () => undefined,
        (error) => {
          console.debug("[Kilo New] OS notification failed", { cmd: command.cmd, error })
        },
      )
    })
    .finally(() => {
      queued -= 1
    })
}
