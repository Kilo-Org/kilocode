import * as os from "os"
import * as vscode from "vscode"
import { exec } from "./process"

/**
 * Send a native OS notification.
 * Uses platform-specific commands so notifications appear even when VS Code is focused.
 */
export async function sendOsNotification(title: string, body: string): Promise<void> {
  switch (os.platform()) {
    case "darwin": {
      const esc = (s: string) =>
        s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")

      // Try terminal-notifier first for richer notifications
      try {
        const extensionUri = vscode.extensions.getExtension(`kilocode.kilo-code`)!.extensionUri
        const iconPath = vscode.Uri.joinPath(extensionUri, "assets", "icons", "kilo.png").fsPath
        await exec("terminal-notifier", ["-message", body, "-title", title, "-appIcon", iconPath])
        break
      } catch {
        // Fall back to osascript if terminal-notifier fails
      }

      // Fallback to osascript
      await exec("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`]).catch((err) => {
        console.log("[Kilo New] macOS notification failed:", err)
      })
      break
    }
    case "linux":
      // notify-send receives raw arguments directly, no shell escaping needed
      await exec("notify-send", [title, body]).catch((err) => {
        console.log("[Kilo New] Linux notification failed:", err)
      })
      break
    case "win32": {
      // base64 encoding prevents injection; use raw text (no shell escaping)
      const encodedTitle = Buffer.from(title, "utf8").toString("base64")
      const encodedBody = Buffer.from(body, "utf8").toString("base64")
      await exec("powershell", [
        "-NonInteractive",
        "-Command",
        `$t = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${encodedTitle}")); ` +
          `$b = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${encodedBody}")); ` +
          `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; ` +
          `$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); ` +
          `$xml = [Windows.Data.Xml.Dom.XmlDocument]::new(); $xml.LoadXml($template.GetXml()); ` +
          `$textNodes = $xml.GetElementsByTagName("text"); ` +
          `$textNodes.Item(0).AppendChild($xml.CreateTextNode($t)) > $null; ` +
          `$textNodes.Item(1).AppendChild($xml.CreateTextNode($b)) > $null; ` +
          `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); ` +
          `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Kilo Code").Show($toast)`,
      ]).catch((err) => {
        console.log("[Kilo New] Windows notification failed:", err)
      })
      break
    }
  }
}
