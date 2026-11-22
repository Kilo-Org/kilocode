import { dirname, join } from "node:path"
import { args } from "./cli"

if (import.meta.main) {
  const dir = dirname(args().request)
  process.on("SIGTERM", () => {
    Bun.write(join(dir, "driver-sigterm"), "")
  })
  await Bun.write(join(dir, "driver-started"), "")
  await Bun.sleep(60_000)
}
