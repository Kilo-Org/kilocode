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
const self = current()

function clean(input: string[]) {
  return input.filter((arg, index) => {
    if (arg === "--cwd") return false
    if (input[index - 1] === "--cwd") return false
    if (arg.startsWith("--cwd=")) return false
    return true
  })
}

function full(input: string) {
  if (path.isAbsolute(input)) return input
  return path.resolve(process.cwd(), input)
}

function current(): Command {
  const script = process.argv[1]
  if (script && /\.(ts|js|mjs|cjs)$/.test(script)) {
    const file = full(script)
    const dir = path.dirname(file)
    const root = path.basename(dir) === "src" ? path.dirname(dir) : process.cwd()
    return { command: full(process.execPath), args: [...clean(process.execArgv), file], cwd: root }
  }
  return { command: full(process.execPath), args: [] }
}

export function resolve(input: Input): Input {
  if (!input.command || !names.has(input.command)) return input
  const args = input.args ?? []
  const project = self.cwd && args.length === 0 && input.cwd ? [input.cwd] : []
  return {
    ...input,
    command: self.command,
    args: [...self.args, ...project, ...args],
    cwd: self.cwd ?? input.cwd,
  }
}

export const KiloPtySelfCommand = {
  resolve,
}
