import path from "node:path"

if (process.env.KILO_BRANDING_TEST_HOSTED === "1") await import("../../src/branding/preload")

const { ensurePluginRuntime } = await import("@opencode/plugin/runtime")
ensurePluginRuntime()

// A plugin that ships its own copy of `effect` and imports a subpath the host does not provide.
const plugin = path.join(process.env.TMPDIR!, "plugin")
await Bun.write(
  path.join(plugin, "node_modules/effect/package.json"),
  JSON.stringify({
    name: "effect",
    type: "module",
    exports: { "./RemovedLegacySubpath": "./RemovedLegacySubpath.js" },
  }),
)
await Bun.write(path.join(plugin, "node_modules/effect/RemovedLegacySubpath.js"), "export const legacy = true")
await Bun.write(
  path.join(plugin, "index.ts"),
  'import { legacy } from "effect/RemovedLegacySubpath"; export default { id: "removed-subpath", legacy }',
)
console.log(
  JSON.stringify(
    await import(path.join(plugin, "index.ts")).then(
      () => "loaded",
      (error: Error) => error.message,
    ),
  ),
)
