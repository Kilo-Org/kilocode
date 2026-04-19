import { CommandData } from "./schemas"
import type { Command, CommandRegistry, CommandScope, KeybindRegistry } from "./schemas"
import { parseBinding, matchParsedBinding } from "./parser"
import { searchCommands } from "./matcher"

/**
 * Create an in-memory command registry.
 *
 * Commands are stored in a `Map<string, Command>`. Listeners are notified
 * synchronously on every register/unregister mutation so that reactive
 * consumers (e.g. SolidJS `createSignal`) can update without polling.
 *
 * Registration validates the serializable subset of the command via
 * `CommandData.parse({ ...cmd })`. The spread strips TS-only function
 * fields (`enabled`, `onSelect`) before Zod sees them, so those fields
 * never cause validation errors.
 *
 * @returns A `CommandRegistry` instance.
 */
export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>()
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    register(cmd: Command): () => void {
      // Validate the serializable subset via Zod. Spreading strips function fields.
      CommandData.parse({ ...cmd })

      if (commands.has(cmd.id)) {
        throw new Error(`Command with id "${cmd.id}" is already registered`)
      }

      commands.set(cmd.id, cmd)
      notify()

      return () => {
        this.unregister(cmd.id)
      }
    },

    unregister(id: string): void {
      if (commands.delete(id)) {
        notify()
      }
    },

    get(id: string): Command | undefined {
      return commands.get(id)
    },

    getAllByScope(scope: CommandScope): Command[] {
      const result: Command[] = []
      for (const cmd of commands.values()) {
        if (cmd.hidden) continue
        if (cmd.scope === scope || cmd.scope === "global") {
          result.push(cmd)
        }
      }
      return result
    },

    search(query: string, scope?: CommandScope): Command[] {
      const candidates =
        scope !== undefined ? this.getAllByScope(scope) : [...commands.values()].filter((c) => !c.hidden)
      return searchCommands(query, candidates)
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Create a keybind registry backed by a `CommandRegistry`.
 *
 * `matchEvent` iterates commands in the requested scope (plus global) and
 * returns the first one whose `keybind.binding` parses to a match for the
 * incoming key event. Uses the internal `parseBinding` + `matchParsedBinding`
 * helpers which replicate the behavior of opencode's `util/keybind.ts`.
 *
 * @param commands - The `CommandRegistry` whose commands are matched against.
 * @returns A `KeybindRegistry` instance.
 */
export function createKeybindRegistry(commands: CommandRegistry): KeybindRegistry {
  return {
    matchEvent(
      evt: {
        name: string
        ctrl: boolean
        meta: boolean
        shift: boolean
        super?: boolean
        leader: boolean
      },
      scope: CommandScope,
    ): Command | undefined {
      const candidates = commands.getAllByScope(scope)

      for (const cmd of candidates) {
        if (!cmd.keybind) continue
        const parsed = parseBinding(cmd.keybind.binding)
        for (const binding of parsed) {
          if (matchParsedBinding(evt, binding)) {
            return cmd
          }
        }
      }

      return undefined
    },
  }
}
