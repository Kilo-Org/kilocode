import path from "path"

type Input = {
  command?: string
  args?: string[]
  cwd?: string
}

type Command = {
  command: string
  args: string[]
  cwd?: string
}

const names = new Set(["kilo", "kilocode"])
const self = command()

function clean(input: string[]) {
  return input.filter((arg, index) => {
    if (arg === "--cwd") return false
    if (input[index - 1] === "--cwd") return false
    if (arg.startsWith("--cwd=")) return false
    return true
  })
}

function full(input: string, cwd: string) {
  if (path.isAbsolute(input)) return input
  return path.resolve(cwd, input)
}

export function command(
  proc = { argv: process.argv, execArgv: process.execArgv, execPath: process.execPath, cwd: process.cwd() },
): Command {
  const script = proc.argv[1]
  const bundled = script?.startsWith("/$bunfs/") || (script ? /^[A-Za-z]:[\\/]~BUN[\\/]/.test(script) : false)
  if (script && !bundled && /\.(ts|js|mjs|cjs)$/.test(script)) {
    const file = full(script, proc.cwd)
    const dir = path.dirname(file)
    const root = path.basename(dir) === "src" ? path.dirname(dir) : proc.cwd
    return { command: full(proc.execPath, proc.cwd), args: [...clean(proc.execArgv), file], cwd: root }
  }
  return { command: full(proc.execPath, proc.cwd), args: [] }
}

export function resolve(input: Input, cmd = self): Input {
  if (!input.command || !names.has(input.command)) return input
  const args = input.args ?? []
  const project = cmd.cwd && args.length === 0 && input.cwd ? [input.cwd] : []
  return {
    ...input,
    command: cmd.command,
    args: [...cmd.args, ...project, ...args],
    cwd: cmd.cwd ?? input.cwd,
  }
}

export const KiloPtySelfCommand = {
  command,
  resolve,
}
