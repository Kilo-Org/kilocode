import path from "node:path"
import type { BunPlugin } from "bun"

/**
 * Upstream files that the host replaces with a Kilo-owned mirror: the upstream path under `packages/`, and the
 * mirror in this directory. Each mirror has a test that fails when it differs from its upstream file anywhere
 * but at its marked Kilo lines.
 */
export const hostMirrors: Record<string, string> = {
  "tui/src/theme/v1.ts": "theme-v1.ts",
  "cli/src/acp/agent.ts": "acp-agent.ts",
  // The project directories of the TUI's themes and local plugins (`.kilo2`, not `.opencode`).
  "tui/src/util/config-directories.ts": "tui-config-directories.ts",
  "tui/src/plugin/discovery.ts": "tui-plugin-discovery.ts",
}

const files = Object.keys(hostMirrors)
  .map((file) => file.replaceAll(".", "\\.").replaceAll("/", "[/\\\\]"))
  .join("|")

export const hostMirrorsPlugin: BunPlugin = {
  name: "kilo-host-mirrors",
  setup(build) {
    build.onLoad({ filter: new RegExp(`[/\\\\]packages[/\\\\](?:${files})$`) }, (args) => {
      // Match by suffix: the checkout path itself may contain a `packages` directory.
      const file = args.path.replaceAll("\\", "/")
      const mirror = Object.entries(hostMirrors).find(([upstream]) => file.endsWith(`/packages/${upstream}`))?.[1]
      if (!mirror) throw new Error(`No Kilo host mirror for ${args.path}`)
      return { contents: `export * from ${JSON.stringify(path.join(import.meta.dir, mirror))}`, loader: "js" }
    })
  },
}
