import type { BunPlugin } from "bun"
import path from "node:path"

export const brandingProbe: BunPlugin = {
  name: "kilo-rebrand-probe",
  setup(build) {
    build.onLoad({ filter: /[/\\]packages[/\\]tui[/\\]src[/\\]logo\.ts$/ }, () => ({
      loader: "ts",
      contents: `export { logo, go } from ${JSON.stringify(path.join(import.meta.dir, "probe-logo.ts"))}`,
    }))
  },
}
