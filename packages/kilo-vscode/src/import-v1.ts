// The temporary "Import from Kilo v1" action for internal users until the release migration lands. It runs
// `kilo2 import v1` with the same command and environment as the server, so it writes the store and config directory
// that server reads, also from a repository checkout with its isolated profile.
import { environment, type Command } from "./server"
import { launch } from "./process"

export function importV1(input: {
  command: Command
  cwd: string
  env: NodeJS.ProcessEnv
  days: number
  log: (text: string) => void
}): Promise<{ ok: boolean; output: string }> {
  const prefix = input.command.args.slice(0, input.command.args.indexOf("serve"))
  const args = [...prefix, "import", "v1", "--since", `${input.days}d`, "--config"]
  const child = launch(input.command.cmd, args, {
    cwd: input.cwd,
    env: environment(input.env, { ...input.command.env, INIT_CWD: input.cwd }),
    stdio: ["ignore", "pipe", "pipe"],
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
  child.on("exit", (code) => result.resolve({ ok: code === 0, output: lines.join("").trim() }))
  return result.promise
}
