import { describe, expect, it } from "bun:test"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const root = path.resolve(import.meta.dir, "../..")
const webview = path.join(root, "webview-ui")

describe("Roo migration UI", () => {
  it("does not handle startup migration state or expose legacy actions", async () => {
    const files = [
      "src/App.tsx",
      "src/types/messages/migration.ts",
      "src/types/messages/extension-messages.ts",
      "src/types/messages/webview-messages.ts",
    ]
    for (const file of files) {
      const text = await Bun.file(path.join(webview, file)).text()
      for (const action of ["migrationState", "clearLegacyData", "skipLegacyMigration", "finalizeLegacyMigration"]) {
        expect(text).not.toContain(action)
      }
    }
  })

  it("imports only Roo sessions with scoped progress, results, and confirmation dialogs", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(import.meta.dir, "roo-migration-ui.fixture.tsx")],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      logLevel: "silent",
      loader: { ".css": "empty" },
      platform: "node",
      plugins: [
        {
          name: "solid-dedupe",
          setup(ctx) {
            ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          },
        },
        solidPlugin(),
      ],
      target: "es2022",
      write: false,
    })
    const file = path.join(import.meta.dir, `.roo-migration-ui-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles.at(0)!.contents)
    try {
      const child = Bun.spawnSync(["bun", file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      const output = child.stdout.toString() + child.stderr.toString()
      expect(child.exitCode, output).toBe(0)
    } finally {
      await Bun.file(file).delete()
    }
  })
})
