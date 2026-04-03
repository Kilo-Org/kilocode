import * as os from "os"
import { exec } from "./process"

/**
 * Send a native OS notification.
 * Uses platform-specific commands so notifications appear even when VS Code is focused.
 */
export async function sendOsNotification(title: string, body: string): Promise<void> {
  const escaped = body.replace(/"/g, '\\"').replace(/'/g, "'\\''")
  const escapedTitle = title.replace(/"/g, '\\"').replace(/'/g, "'\\''")

  switch (os.platform()) {
    case "darwin":
      await exec("osascript", ["-e", `display notification "${escaped}" with title "${escapedTitle}"`])
      break
    case "linux":
      await exec("notify-send", [escapedTitle, escaped]).catch(() => {
        // notify-send may not be installed — fall back silently
      })
      break
    case "win32":
      await exec("powershell", [
        "-NonInteractive",
        "-Command",
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; ` +
          `$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); ` +
          `$xml = [Windows.Data.Xml.Dom.XmlDocument]::new(); $xml.LoadXml($template.GetXml()); ` +
          `$textNodes = $xml.GetElementsByTagName("text"); ` +
          `$textNodes.Item(0).AppendChild($xml.CreateTextNode("${escapedTitle}")) > $null; ` +
          `$textNodes.Item(1).AppendChild($xml.CreateTextNode("${escaped}")) > $null; ` +
          `$toast = [Windows.UI.Notifications.ToastNotification]::new($xml); ` +
          `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Kilo Code").Show($toast)`,
      ])
      break
  }
}
