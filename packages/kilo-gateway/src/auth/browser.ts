import { execFile } from "child_process"

/**
 * Builds a browser launch without a command shell. On Windows, `cmd /c start` would
 * interpret characters such as `&` in the URL, so the URL protocol handler is used instead.
 */
export function command(input: string, platform = process.platform) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
    throw new Error(`Only http and https links can be opened in the browser: ${input}`)
  if (platform === "darwin") return { file: "open", args: [url.href] }
  if (platform === "win32") return { file: "rundll32", args: ["url.dll,FileProtocolHandler", url.href] }
  return { file: "xdg-open", args: [url.href] }
}

export function launch(url: string) {
  const cmd = command(url)
  // windowsHide prevents a console window from flashing on Windows.
  execFile(cmd.file, cmd.args, { windowsHide: true })
}
