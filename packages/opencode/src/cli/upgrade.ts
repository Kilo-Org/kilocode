import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"

export async function upgrade() {
  const config = await Config.global()
  const method = await Installation.method()
  // kilocode_change start - only auto-upgrade for npm (we only publish @kilocode/cli via npm)
  if (method !== "npm") return
  // kilocode_change end
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return
  if (Installation.VERSION === latest) return

  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) {
    return
  }
  if (config.autoupdate === "notify") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
