// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md" with { type: "text" }
import KILO_CUSTOMIZATION from "./kilo-customization.md" with { type: "text" }
import KILO_TOOLS from "./kilo-tools.md" with { type: "text" }
import KILO_AGENT_MANAGER from "./kilo-agent-manager.md" with { type: "text" }
import KILO_TUI from "./kilo-tui.md" with { type: "text" }

export interface BuiltinSkill {
  name: string
  description: string
  content: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Locate Kilo config files, resolve precedence, and set kilo.json options, including models and providers.",
    content: KILO_CONFIG,
  },
  {
    name: "kilo-customization",
    description: "Create or locate Kilo custom commands, agents, skills, and legacy workflows.",
    content: KILO_CUSTOMIZATION,
  },
  {
    name: "kilo-tools",
    description: "Configure Kilo tool permissions and local or remote MCP servers.",
    content: KILO_TOOLS,
  },
  {
    name: "kilo-agent-manager",
    description:
      "Configure VS Code Agent Manager setup/run scripts, integrate worktrees, or troubleshoot conflicts and missing worktree/session state.",
    content: KILO_AGENT_MANAGER,
  },
  {
    name: "kilo-tui",
    description: "Find Kilo CLI keybinds, slash commands, themes, and interactive display or session controls.",
    content: KILO_TUI,
  },
]
