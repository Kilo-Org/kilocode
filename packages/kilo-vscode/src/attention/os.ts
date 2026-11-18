// Native OS notifications through each platform's own command-line tool, as on v1
// (packages/kilo-vscode/src/services/attention/os.ts on main): `osascript` on macOS, `notify-send` on Linux and a
// WinRT toast through PowerShell on Windows. No native dependency.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { env } from "vscode"
import { exec } from "../process"
import { t } from "./i18n"
import { lines, type AttentionNotice } from "./notice"

type Command = {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

/** The platforms with a native notification command. */
export const OS_NOTIFICATION_PLATFORMS: readonly NodeJS.Platform[] = ["darwin", "linux", "win32"]

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

// libnotify parses the body as Pango markup, so an unescaped `<` or `&` in a workspace or session name can drop the
// notification or inject markup.
function pango(value: string) {
  return value.replace(/[&<>]/g, (char) => entities[char] ?? char)
}

function apple(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
}

/**
 * The AppUserModelID Windows attributes the toast to. Reading it from the running host's `product.json` keeps Cursor
 * and other forks working without a hardcoded editor-name mapping.
 */
export async function readAppID(root: string | undefined): Promise<string | undefined> {
  // `appRoot` is not guaranteed to be populated on every host.
  if (!root) return undefined
  const parsed: unknown = await readFile(path.join(root, "product.json"), "utf8")
    .then((raw) => JSON.parse(raw) as unknown)
    .catch((error: unknown) => {
      console.debug("[Kilo] could not read product.json for the notification identity", { root, error })
      return undefined
    })
  const value =
    typeof parsed === "object" && parsed !== null ? (parsed as { win32AppUserModelId?: unknown }).win32AppUserModelId : undefined
  // A missing or malformed field must fail safely rather than attribute the toast to the wrong application.
  if (typeof value !== "string") return undefined
  const appid = value.trim()
  if (!appid || appid.length > 256) return undefined
  if (/[\u0000-\u001f\u007f]/.test(appid)) return undefined
  return appid
}

let cached: Promise<string | undefined> | undefined

/** Cached for the host's lifetime; `appRoot` cannot change while it runs. */
function resolveAppID(platform: NodeJS.Platform): Promise<string | undefined> {
  if (platform !== "win32") return Promise.resolve(undefined)
  cached ??= readAppID(env.appRoot)
  return cached
}

export function notificationCommand(
  notice: AttentionNotice,
  platform: NodeJS.Platform,
  appid?: string,
): Command | undefined {
  if (platform === "win32") {
    // Without a verified identity Windows would either drop the toast or attribute it to another editor.
    if (!appid) return undefined
    const xml = `<toast><visual><binding template="ToastGeneric"><text>${escape(notice.message)}</text>${notice.workspace ? `<text>${escape(t("attention.workspace"))}: ${escape(notice.workspace)}</text>` : ""}${notice.session ? `<text>${escape(t("attention.session"))}: ${escape(notice.session)}</text>` : ""}</binding></visual></toast>`
    // The XML and the identity are environment data, never interpolated into the script. XML escaping does not
    // neutralize the Unicode smart quotes (U+2018/U+2019) that PowerShell also accepts as string delimiters, so a
    // crafted session title could otherwise close the string literal and run arbitrary commands.
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
  if (platform === "darwin")
    return {
      cmd: "osascript",
      args: ["-e", `display notification "${apple(lines(notice).join("\n"))}" with title "Kilo Code"`],
    }
  // Only the body is markup; the summary is taken literally.
  if (platform === "linux")
    return {
      cmd: "notify-send",
      args: ["--app-name=Kilo Code", "--urgency=normal", "Kilo Code", pango(lines(notice).join("\n"))],
    }
  return undefined
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
  const command = notificationCommand({ message: t("attention.test") }, platform, await resolveAppID(platform))
  if (!command) return { ok: false, error: t(platform === "win32" ? "attention.identity" : "attention.unsupported") }
  return run(command).then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
}

/** Shows a native notification. Serialized with a small cap, so bursts cannot pile up helper processes. */
export function showOSNotification(notice: AttentionNotice): void {
  if (queued >= limit) return
  queued += 1
  chain = chain
    .then(async () => {
      const command = notificationCommand(notice, process.platform, await resolveAppID(process.platform))
      if (!command) return
      await run(command).then(
        () => undefined,
        (error: unknown) => console.debug("[Kilo] OS notification failed", { cmd: command.cmd, error }),
      )
    })
    .finally(() => {
      queued -= 1
    })
}
