// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md"
import MMX_CLI from "./mmx-cli.md"

export interface BuiltinSkill {
  name: string
  description: string
  content: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Guide for configuring Kilo CLI and locating config, command, agent, and skill paths (global, project, legacy), plus MCP servers, permissions, instructions, plugins, providers, kilo.json fields, and TUI settings (themes, appearance, keybinds, ctrl+p commands). Use when the user asks about configuring Kilo, where it loads things from, or how to change settings.",
    content: KILO_CONFIG,
  },
  {
    name: "mmx-cli",
    description:
      "Use mmx to generate text, images, video, speech, and music via the MiniMax AI platform. Use when the user wants to create media content, chat with MiniMax models, perform web search, or manage MiniMax API resources from the terminal.",
    content: MMX_CLI,
  },
]
