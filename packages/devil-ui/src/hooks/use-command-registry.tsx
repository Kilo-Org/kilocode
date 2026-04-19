import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  type JSX,
  type Accessor,
} from "solid-js"
import {
  createCommandRegistry,
  createKeybindRegistry,
} from "@devilcode/keybind"
import type { Command, CommandRegistry, CommandScope, KeybindRegistry } from "@devilcode/keybind"

// ─── Context ──────────────────────────────────────────────────────────────────

interface CommandRegistryContextValue {
  commands: CommandRegistry
  keybinds: KeybindRegistry
}

const CommandRegistryContext = createContext<CommandRegistryContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface CommandRegistryProviderProps {
  /** Optionally supply a pre-created registry. Defaults to a fresh one. */
  registry?: CommandRegistry
  children: JSX.Element
}

/**
 * Provides a `CommandRegistry` + `KeybindRegistry` pair to its subtree.
 * Mount once near the top of the application (or TUI view) tree.
 */
export function CommandRegistryProvider(props: CommandRegistryProviderProps): JSX.Element {
  const commands = props.registry ?? createCommandRegistry()
  const keybinds = createKeybindRegistry(commands)
  return (
    <CommandRegistryContext.Provider value={{ commands, keybinds }}>
      {props.children}
    </CommandRegistryContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseCommandRegistryResult {
  /**
   * Reactive accessor — value contains only global-scope commands, but SolidJS tracks it as a
   * dependency for all registry mutations (any scope). Primitives that need scope-specific
   * commands should call `registry.search("", scope)` inside a `createMemo` after reading
   * `entries()` to establish the reactive dependency.
   */
  entries: Accessor<Command[]>
  /** Register a command. Returns an unregister function. */
  register(cmd: Command): () => void
  /** Remove a command by id. */
  unregister(id: string): void
  /** Look up a command by id. */
  get(id: string): Command | undefined
  /** Fuzzy-search commands, optionally filtered by scope. */
  search(query: string, scope?: CommandScope): Command[]
  /** Match a key event against registered commands in the given scope. */
  matchEvent: KeybindRegistry["matchEvent"]
}

/**
 * Returns the nearest `CommandRegistry` and `KeybindRegistry`.
 *
 * `entries` is a reactive `Accessor<Command[]>` that updates whenever
 * commands are registered or unregistered. The subscription is set up
 * **synchronously** in the hook body so it works under the `createRoot`
 * test harness (which does NOT trigger `onMount`).
 *
 * @throws If called outside a `<CommandRegistryProvider>`.
 */
export function useCommandRegistry(): UseCommandRegistryResult {
  const ctx = useContext(CommandRegistryContext)
  if (!ctx) {
    throw new Error("useCommandRegistry must be called inside a <CommandRegistryProvider>")
  }

  // Subscribe synchronously — NOT inside onMount.
  const [entries, setEntries] = createSignal<Command[]>(ctx.commands.getAllByScope("global"))
  const unsub = ctx.commands.subscribe(() => {
    // Deliberately spreads into a new array on every registry mutation — including mutations in
    // non-global scopes — so that any SolidJS primitive tracking `entries()` re-runs whenever
    // the registry changes, regardless of which scope was affected. The value itself is
    // intentionally limited to "global" commands; callers that need a different scope should
    // read `entries()` (to subscribe) and then call `registry.search("", scope)` for the data.
    setEntries([...ctx.commands.getAllByScope("global")])
  })
  onCleanup(unsub)

  return {
    entries,
    register: (cmd) => ctx.commands.register(cmd),
    unregister: (id) => ctx.commands.unregister(id),
    get: (id) => ctx.commands.get(id),
    search: (query, scope) => ctx.commands.search(query, scope),
    matchEvent: (evt, scope) => ctx.keybinds.matchEvent(evt, scope),
  }
}
