import { z } from "zod"

/**
 * UI context scopes for commands. This is a rendering/navigation taxonomy,
 * distinct from the team capability stages defined in opencode.
 *
 * - global: available in all contexts
 * - workflow: active inside the main workflow/agent TUI view
 * - team-builder: active inside the team-builder view
 * - review: active inside the review / session-review view
 */
export const CommandScope = z.enum(["global", "workflow", "team-builder", "review"])
export type CommandScope = z.infer<typeof CommandScope>

/**
 * A single keybinding in canonical string form.
 *
 * Examples:
 *   "ctrl+k"        — Ctrl+K
 *   "<leader> p"    — leader then p (flat chain only)
 *   "ctrl+k,alt+k"  — either Ctrl+K or Alt+K
 */
export const Keybind = z.object({
  /** Canonical string form, e.g. "ctrl+k" or "<leader> p" (matches existing util/keybind parser). */
  binding: z.string().min(1),
  /** True if this binding participates in the Ctrl+X leader chain. */
  leader: z.boolean().default(false),
})
export type Keybind = z.infer<typeof Keybind>

/**
 * Serializable subset of a command — everything that Zod can validate.
 * Function fields (enabled, onSelect) are intentionally excluded: Zod 4.1.8
 * removed the `.returns()` fluent API and cannot meaningfully validate function
 * bodies. Use runtime guards (`typeof cmd.onSelect === "function"`) instead.
 */
export const CommandData = z.object({
  /** Stable unique identifier across all scopes. */
  id: z.string().min(1),
  /** Label shown in the command palette. */
  title: z.string().min(1),
  /** Optional longer description shown in help overlay. */
  description: z.string().optional(),
  /** Which UI context this command belongs to. */
  scope: CommandScope,
  /** Alternative names that also match this command in search. */
  aliases: z.array(z.string()).default([]),
  /** Search tokens that contribute to fuzzy-match score but are NOT rendered. */
  hideKeywords: z.array(z.string()).default([]),
  /** Optional keybinding. */
  keybind: Keybind.optional(),
  /** When true, hidden from the palette. Still matchable via keybind. */
  hidden: z.boolean().default(false),
})
export type CommandData = z.infer<typeof CommandData>

/**
 * Full command type = Zod-validated data + TS-only function fields.
 *
 * IMPORTANT: Do NOT add `enabled` or `onSelect` to `CommandData` Zod schema.
 * Zod 4.1.8 removed `z.function().returns(...)`. Use runtime guards.
 */
export interface Command extends CommandData {
  /** Predicate evaluated at render time. Falsy means the command is disabled. */
  enabled?: () => boolean
  /** Callback invoked when user selects this command. */
  onSelect?: (ctx?: unknown) => void | Promise<void>
}

/**
 * In-memory command registry interface.
 * Not persisted — rebuilt on each mount.
 */
export interface CommandRegistry {
  /** Register a command. Returns an unregister function. */
  register(cmd: Command): () => void
  /** Remove a command by id. No-op if not found. */
  unregister(id: string): void
  /** Look up a command by its id. */
  get(id: string): Command | undefined
  /**
   * Return all visible (non-hidden) commands for the given scope.
   * Global commands are always included regardless of requested scope.
   */
  getAllByScope(scope: CommandScope): Command[]
  /**
   * Fuzzy-search commands optionally scoped. Empty query returns all visible commands.
   */
  search(query: string, scope?: CommandScope): Command[]
  /**
   * Subscribe to registry mutations (register/unregister).
   * Returns an unsubscribe function.
   *
   * Required so SolidJS consumers (use-command-registry hook) can
   * reactively track entries() without polling or monkey-patching.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Keybind registry: maps parsed key events to registered commands.
 */
export interface KeybindRegistry {
  /**
   * Match a parsed key event against registered commands in the given scope.
   * Returns the first matching command, or undefined if none matches.
   */
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
  ): Command | undefined
}
