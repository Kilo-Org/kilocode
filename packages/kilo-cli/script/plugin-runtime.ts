import type { BunPlugin } from "bun"
import { discoverPluginRuntimeSpecifiers, pluginRuntimeLoaderCode } from "@opencode/plugin/runtime-modules"

export function createPluginRuntimePlugin(): BunPlugin {
  const entries = discoverPluginRuntimeSpecifiers()
  const source = [
    "export const resolveHostPackageRoots = () => []",
    "const modules = {",
    ...[...entries.keys()].map(
      (specifier) => `  ${JSON.stringify(specifier)}: ${pluginRuntimeLoaderCode(specifier, entries)},`,
    ),
    "}",
    "export const loadRuntimeModules = () => modules",
  ].join("\n")
  return {
    name: "opencode-plugin-runtime",
    setup(build) {
      build.onLoad({ filter: /plugin[/\\]src[/\\]runtime-modules\.ts$/ }, () => ({ contents: source, loader: "ts" }))
      build.onLoad({ filter: /[/\\]internal[/\\]httpApi(?:Scalar|Swagger)\.js$/ }, () => ({
        contents:
          'export const css = ""; export const javascript = \'document.body.textContent = "Scalar/Swagger UI assets are not bundled in OpenCode"\'',
        loader: "js",
      }))
    },
  }
}
