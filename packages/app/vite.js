import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import { resolve as resolvePath } from "path"

// kilocode_change start
const kiloUiDir = resolvePath(fileURLToPath(new URL(".", import.meta.url)), "../kilo-ui").replace(/\\/g, "/") // Normalize to forward slashes for cross-platform compatibility

/**
 * Vite plugin that redirects @opencode-ai/ui imports to @kilocode/kilo-ui,
 * but only for importers OUTSIDE of kilo-ui itself. This avoids circular
 * resolution when kilo-ui re-exports from @opencode-ai/ui.
 * Excludes audio/* and fonts/* which are binary assets.
 * @type {import("vite").Plugin}
 */
const kiloUiAlias = {
  name: "kilo-ui-alias",
  enforce: "pre",
  resolveId(source, importer) {
    if (!source.startsWith("@opencode-ai/ui")) return
    const normalizedImporter = importer?.replace(/\\/g, "/")
    if (normalizedImporter?.startsWith(kiloUiDir)) return
    const sub = source.replace("@opencode-ai/ui", "")
    if (sub.startsWith("/audio/") || sub.startsWith("/fonts/")) return
    return this.resolve(source.replace("@opencode-ai/ui", "@kilocode/kilo-ui"), importer, {
      skipSelf: true,
    })
  },
}
// kilocode_change end

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "kilo-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  kiloUiAlias, // kilocode_change
  tailwindcss(),
  solidPlugin(),
]
