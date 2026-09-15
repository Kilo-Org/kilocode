// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md" with { type: "text" }
import CONFIGURATION from "./kilo-config-configuration.md" with { type: "text" }
import CUSTOMIZATION from "./kilo-config-customization.md" with { type: "text" }
import TOOLS from "./kilo-config-tools.md" with { type: "text" }
import AGENT_MANAGER from "./kilo-config-agent-manager.md" with { type: "text" }
import TUI from "./kilo-config-tui.md" with { type: "text" }
import type { Skill } from "../../skill"

export interface BuiltinSkill {
  name: string
  description: string
  content: string
  references?: Record<string, string>
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Configure Kilo settings, MCP, commands, agents, skills, TUI controls, or Agent Manager scripts and worktrees.",
    content: KILO_CONFIG,
    references: {
      configuration: CONFIGURATION,
      customization: CUSTOMIZATION,
      tools: TOOLS,
      "agent-manager": AGENT_MANAGER,
      tui: TUI,
    },
  },
]

export function content(info: Skill.Info, reference?: string) {
  if (reference == null) return info.content
  if (info.location !== "builtin") {
    throw new Error(
      `Skill "${info.name}" is not a built-in skill. References are unavailable for user-provided skills.`,
    )
  }
  const refs = BUILTIN_SKILLS.find((skill) => skill.name === info.name)?.references
  if (!refs || !Object.hasOwn(refs, reference)) {
    throw new Error(`Reference "${reference}" not found for skill "${info.name}". Use a reference named in its guide.`)
  }
  return refs[reference]
}
