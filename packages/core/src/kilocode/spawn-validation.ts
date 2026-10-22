import type { Effect } from "effect"
import type { ChildProcess } from "effect/unstable/process"

const effects = new WeakMap<object, Effect.Effect<void, unknown>>()

export function attach(command: ChildProcess.StandardCommand, effect: Effect.Effect<void, unknown>) {
  effects.set(command, effect)
  return command
}

export function take(command: ChildProcess.StandardCommand) {
  const effect = effects.get(command)
  effects.delete(command)
  return effect
}
