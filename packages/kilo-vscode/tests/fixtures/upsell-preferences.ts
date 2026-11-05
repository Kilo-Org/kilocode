import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { SidebarUpsell } from "../../src/kilo-provider/upsell"
import { UpsellPreferences } from "../../src/kilo-provider/upsell-preferences"
import type { UpsellAction } from "../../src/shared/agent-manager-upsell"

const dir = process.argv.at(2)!
const prefs = new UpsellPreferences(dir)
const clock = { now: 10_000 }
const host = new SidebarUpsell(
  prefs,
  {
    get: <T>(_key: string, _fallback: T) => ["first", "second"] as T,
    update: async () => {},
  },
  () => clock.now,
)

process.on(
  "message",
  async (message: {
    id: string
    action: UpsellAction | "load" | "observed" | "orphan"
    now: number
    count?: number
  }) => {
    try {
      clock.now = message.now
      if (message.action === "orphan") {
        // Model interruption before atomic publication: incomplete staging is never authoritative.
        await mkdir(join(dir, "agent-manager-upsell"), { recursive: true })
        await writeFile(join(dir, "agent-manager-upsell", ".interrupted.tmp"), '{"optedOut":')
        process.send?.({ id: message.id, result: "staged" })
        return
      }
      if (message.action === "observed") {
        for (let count = 0; count < (message.count ?? 1); count++) await host.opened()
        process.send?.({ id: message.id, result: await prefs.read() })
        return
      }
      const result = await host.handle(message.action === "load" ? undefined : message.action, true)
      process.send?.({ id: message.id, result })
    } catch (err) {
      process.send?.({ id: message.id, error: String(err) })
    }
  },
)

const shown = (await host.handle("shown", true)).display
if (shown) await host.handle("rendered", true)
process.send?.({ id: "ready", result: shown })
