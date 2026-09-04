import * as vscode from "vscode"
import { exec } from "../../util/process"
import type { AttentionNotice } from "./service"

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

function app() {
  return vscode.env.appName.includes("Insiders") ? "Microsoft.VisualStudioCodeInsiders" : "Microsoft.VisualStudioCode"
}

let chain = Promise.resolve()
let queued = 0
const limit = 3
const timeout = 10_000

export function showWindowsNotification(notice: AttentionNotice): void {
  if (process.platform !== "win32") return
  if (queued >= limit) return
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${escape(notice.message)}</text>${notice.workspace ? `<text>Workspace: ${escape(notice.workspace)}</text>` : ""}${notice.session ? `<text>Session: ${escape(notice.session)}</text>` : ""}</binding></visual></toast>`
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null",
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$xml.LoadXml('${xml}')`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${app()}').Show($toast)`,
  ].join("; ")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  queued += 1
  // Serialized with a small cap so bursts cannot pile up PowerShell processes.
  chain = chain
    .then(() =>
      exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { timeout }).then(
        () => undefined,
        (error) => {
          console.debug("[Kilo New] Windows notification failed", { error })
        },
      ),
    )
    .finally(() => {
      queued -= 1
    })
}
