import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get())) // kilocode_change - include env and managed overlays
  if (config.autoupdate === false) return // kilocode_change - env overlay is applied before managed config
  const method = await Installation.method()
  // kilocode_change start - only auto-upgrade for npm/pnpm/bun (we only publish @kilocode/cli via npm registry)
  if (method !== "npm" && method !== "pnpm" && method !== "bun") return
  // kilocode_change end
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (InstallationVersion === latest) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
