/**
 * Persisted, machine-global "notice" flags shared by every Kilo surface (TUI, VS Code
 * extension, etc.) that talks to a local `kilo serve` instance.
 *
 * Backed by a small JSON file under `Global.Path.state` so it survives across CLI
 * invocations and is visible to the VS Code extension's embedded `kilo serve` process,
 * without requiring a database or per-project scoping.
 */
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { Filesystem } from "@/util/filesystem"

const CLOUD_AGENT_USED = "cloud_agent_used"
const MOBILE_APP_NOTICE_DISMISSED = "mobile_app_notice_dismissed"

export namespace Notices {
  const filePath = path.join(Global.Path.state, "notices.json")
  const lock = `kilo-notices:${filePath}`

  async function read(): Promise<Record<string, boolean | undefined>> {
    return Filesystem.readJson<Record<string, boolean | undefined>>(filePath).catch(() => ({}))
  }

  async function update(patch: Record<string, boolean>): Promise<void> {
    await Flock.withLock(lock, async () => {
      const current = await read()
      await Filesystem.writeJson(filePath, { ...current, ...patch })
    })
  }

  /** Record that the user has enabled a remote/Cloud Agent session relay at least once. */
  export async function markCloudAgentUsed(): Promise<void> {
    const current = await read()
    if (current[CLOUD_AGENT_USED]) return
    await update({ [CLOUD_AGENT_USED]: true })
  }

  /** Whether the "continue in the Kilo mobile app" notice should be shown. */
  export async function shouldShowMobileAppNotice(): Promise<boolean> {
    const current = await read()
    return !!current[CLOUD_AGENT_USED] && !current[MOBILE_APP_NOTICE_DISMISSED]
  }

  export async function dismissMobileAppNotice(): Promise<void> {
    await update({ [MOBILE_APP_NOTICE_DISMISSED]: true })
  }
}
