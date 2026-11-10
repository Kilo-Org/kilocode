import path from "node:path"
import type { BunPlugin } from "bun"

export const hostMirrorsPlugin: BunPlugin = {
  name: "kilo-host-mirrors",
  setup(build) {
    build.onLoad(
      {
        filter: /[/\\]packages[/\\](?:tui[/\\]src[/\\]theme[/\\]v1|cli[/\\]src[/\\](?:acp[/\\]agent|run[/\\]run))\.ts$/,
      },
      (args) => ({
        contents: `export * from ${JSON.stringify(path.join(import.meta.dir, args.path.endsWith("agent.ts") ? "acp-agent.ts" : args.path.endsWith("run.ts") ? "cli-run.ts" : "theme-v1.ts"))}`,
        loader: "js",
      }),
    )
  },
}
