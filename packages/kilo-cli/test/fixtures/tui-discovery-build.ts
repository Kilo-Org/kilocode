// Compiles the discovery fixture into an executable: `<outfile> <hosted|unhosted>`. Hosted builds use the host's
// mirror loader, as packages/kilo-cli/script/build.ts does.
import path from "node:path"
import { hostMirrorsPlugin } from "../../src/mirrors"
import { compileDefine } from "./compile-define"

const [outfile, mode] = process.argv.slice(2)
const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "tui-discovery.ts")],
  plugins: mode === "hosted" ? [hostMirrorsPlugin] : [],
  compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
  define: compileDefine,
})
if (!result.success) {
  console.error(result.logs.map(String).join("\n"))
  process.exit(1)
}
