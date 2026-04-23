import { Bus } from "@/bus"
import { Config } from "@/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@/installation/version"

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  const method = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.method()))
  // kilocode_change start - only auto-upgrade for npm/pnpm/bun (we only publish @kilocode/cli via npm registry)
  if (method !== "npm" && method !== "pnpm" && method !== "bun") return
  // kilocode_change end
  const latest = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.latest(method))).catch(() => {})
  if (!latest) return

  if (Flag.KILO_ALWAYS_NOTIFY_UPDATE) {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (InstallationVersion === latest) return
  if (config.autoupdate === false || Flag.KILO_DISABLE_AUTOUPDATE) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  await AppRuntime.runPromise(Installation.Service.use((svc) => svc.upgrade(method, latest)))
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
