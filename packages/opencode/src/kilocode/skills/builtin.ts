// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md"

export interface BuiltinSkill {
  name: string
  description: string
  content: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Guide for configuring Kilo CLI: commands, agents, MCP servers, skills, permissions, instructions, plugins, providers, all kilo.json fields, and TUI settings (themes, appearance, keybinds, ctrl+p commands). Use when the user asks about configuring, customizing, or changing settings in Kilo.",
    content: KILO_CONFIG,
  },
]
