import path from "node:path"
import type { BunPlugin } from "bun"

export const themeRegistryPlugin: BunPlugin = {
  name: "kilo-theme-registry",
  setup(build) {
    build.onLoad({ filter: /[/\\]packages[/\\]tui[/\\]src[/\\]theme[/\\]v1\.ts$/ }, () => ({
      contents: `export * from ${JSON.stringify(path.join(import.meta.dir, "theme-v1.ts"))}`,
      loader: "js",
    }))
  },
}
