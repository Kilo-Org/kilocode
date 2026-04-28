import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { AppRuntime } from "@/effect/app-runtime"
import { Installation } from "../../installation"
import { InstallationVersion } from "../../installation/version"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade kilo to the latest or a specific version", // kilocode_change
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.method()))
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`kilo is installed to ${process.execPath} and may be managed by a package manager`) // kilocode_change
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target
      ? args.target.replace(/^v/, "")
      : await AppRuntime.runPromise(Installation.Service.use((svc) => svc.latest()))

    if (InstallationVersion === target) {
      prompts.log.warn(`kilo upgrade skipped: ${target} is already installed`) // kilocode_change
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${InstallationVersion} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.upgrade(method, target))).catch(
      (err) => err,
    )
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        // kilocode_change start - removed choco special case
        prompts.log.error(err.stderr)
        // necessary because choco only allows install/upgrade in elevated terminals
        // if (method === "choco" && err.stderr.includes("not running from an elevated command shell")) {
        //   prompts.log.error("Please run the terminal as Administrator and try again")
        // } else {
        //   prompts.log.error(err.stderr)
        // }
        // kilocode_change end
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
