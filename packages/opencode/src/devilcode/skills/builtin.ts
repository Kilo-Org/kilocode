// devilcode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import DEVIL_CONFIG from "./kilo-config.md"

export interface BuiltinSkill {
  name: string
  description: string
  content: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Guide for configuring Devil CLI and locating config, command, agent, and skill paths (global, project, legacy), plus MCP servers, permissions, instructions, plugins, providers, kilo.json fields, and TUI settings (themes, appearance, keybinds, ctrl+p commands). Use when the user asks about configuring Devil, where it loads things from, or how to change settings.",
    content: DEVIL_CONFIG,
  },
]
