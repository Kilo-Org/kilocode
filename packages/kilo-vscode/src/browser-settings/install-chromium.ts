// Runs `kilo browser install-chromium` with the command and environment of the spawned server, so the Chromium lands in
// the data directory that server reads, also from a repository checkout with its isolated profile.
import { environment, type Command } from "../server"
import { launch } from "../process"

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
  const result = Promise.withResolvers<{ ok: boolean; output: string }>()
  const lines: string[] = []
  const collect = (chunk: Buffer) => {
    const text = chunk.toString()
    input.log(text)
    lines.push(text)
  }
  child.stdout?.on("data", collect)
  child.stderr?.on("data", collect)
  child.on("error", (error) => result.resolve({ ok: false, output: error.message }))
  // `close` comes after both output streams ended, so the summary line is never cut off.
  child.on("close", (code) => result.resolve({ ok: code === 0, output: lines.join("").trim() }))
  return result.promise
}
