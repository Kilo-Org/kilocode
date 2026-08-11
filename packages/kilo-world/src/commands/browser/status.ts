import { Runner } from "../../core/browser/runner"
import type { BrowserStatus } from "../../types"
import { getConfig } from "../../config"

export namespace Status {
  export async function run(): Promise<BrowserStatus> {
    const cfg = getConfig()
    const probe = await Runner.probeChromium()
    const version = Runner.version()
    const display =
      process.platform === "win32" || process.platform === "darwin"
        ? process.platform
        : (process.env["DISPLAY"] ?? process.env["WAYLAND_DISPLAY"] ?? process.env["MIR_SOCKET"])
    return {
      sessions: Runner.listSessions(),
      capability: {
        headless: cfg.browser.headless,
        ...(display ? { display } : {}),
        chromiumReady: probe.state === "available",
        ...(version ? { chromiumVersion: version } : {}),
        installation: probe,
      },
      chromiumPid: null,
    }
  }
}
