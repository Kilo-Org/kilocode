// kilocode_change - new file
import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"

// Keep the top-level import graph light: this module is registered eagerly at CLI
// startup, so implementation dependencies are imported inside the handler (same
// deferral pattern as upstream opencode#30453).
export const ConfigCommand = cmd({
  command: "config",
  describe: "configuration tools",
  builder: (yargs) =>
    yargs
      .command({
        command: "check",
        describe: "check configuration for warnings and errors",
        async handler() {
          const { bootstrap } = await import("../bootstrap")
          const { AppRuntime } = await import("../../effect/app-runtime")
          const { Config } = await import("../../config/config")
          await bootstrap(process.cwd(), async () => {
            const list = await AppRuntime.runPromise(Config.Service.use((svc) => svc.warnings()))
            if (list.length === 0) {
              process.stdout.write("No config warnings." + EOL)
              return
            }
            const S = UI.Style
            for (const warning of list) {
              process.stderr.write(S.TEXT_WARNING_BOLD + warning.path + S.TEXT_NORMAL + EOL)
              process.stderr.write("  " + warning.message + EOL)
              if (warning.detail) {
                for (const line of warning.detail.split("\n")) {
                  process.stderr.write("  " + S.TEXT_DIM + line + S.TEXT_NORMAL + EOL)
                }
              }
              process.stderr.write(EOL)
            }
            process.exitCode = 1
          })
        },
      })
      .demandCommand(),
  async handler() {},
})
