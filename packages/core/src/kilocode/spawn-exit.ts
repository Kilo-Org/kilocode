import type { ChildProcess } from "effect/unstable/process"

const commands = new WeakSet<object>()

export function attach(command: ChildProcess.StandardCommand) {
  commands.add(command)
  return command
}

export function take(command: ChildProcess.StandardCommand) {
  const found = commands.has(command)
  commands.delete(command)
  return found
}
