// Schemas and types
export { CommandScope, Keybind, CommandData } from "./schemas"
export type { Command, CommandRegistry, KeybindRegistry } from "./schemas"

// Factories
export { createCommandRegistry, createKeybindRegistry } from "./registry"

// Matcher
export { searchCommands } from "./matcher"

// Leader chain
export { createLeaderChain } from "./leader"
export type { LeaderChain, LeaderChainOptions } from "./leader"

// NOTE: parseBinding (src/parser.ts) is intentionally NOT exported.
// It is an internal implementation detail. Phase 5 can swap it for
// the shared opencode parser without breaking the public surface.
