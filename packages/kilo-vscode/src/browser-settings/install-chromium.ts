// Runs `kilo browser install-chromium` with the command and environment of the spawned server, so the Chromium lands in
// the data directory that server reads, also from a repository checkout with its isolated profile.
import { environment, type Command } from "../server"
import { collected, launch } from "../process"

export function installChromium(input: {
  command: Command
  cwd: string
  env: NodeJS.ProcessEnv
  log: (text: string) => void
}): Promise<{ ok: boolean; output: string }> {
  // The server command is `<cli> serve …`; the same CLI takes the subcommand before it.
  const prefix = input.command.args.slice(0, input.command.args.indexOf("serve"))
  const child = launch(input.command.cmd, [...prefix, "browser", "install-chromium"], {
    cwd: input.cwd,
    env: environment(input.env, { ...input.command.env, INIT_CWD: input.cwd }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  return collected(child, input.log)
}
