// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import type { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import path from "node:path"
import KILO_CONFIG from "./kilo-config.md" with { type: "text" }
import CONFIGURATION from "./kilo-config-configuration.md" with { type: "text" }
import CUSTOMIZATION from "./kilo-config-customization.md" with { type: "text" }
import TOOLS from "./kilo-config-tools.md" with { type: "text" }
import AGENT_MANAGER from "./kilo-config-agent-manager.md" with { type: "text" }
import TUI from "./kilo-config-tui.md" with { type: "text" }

export interface BuiltinSkill {
  name: string
  description: string
  content: string
  files?: Record<string, string>
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "kilo-config",
    description:
      "Configure Kilo settings, MCP, commands, agents, skills, TUI controls, or Agent Manager scripts and worktrees.",
    content: KILO_CONFIG,
    files: {
      "references/configuration.md": CONFIGURATION,
      "references/customization.md": CUSTOMIZATION,
      "references/tools.md": TOOLS,
      "references/agent-manager.md": AGENT_MANAGER,
      "references/tui.md": TUI,
    },
  },
]

export const materialize = Effect.fn("BuiltinSkill.materialize")(function* (
  name: string,
  root: string,
  fs: FSUtil.Interface,
) {
  const skill = BUILTIN_SKILLS.find((skill) => skill.name === name)
  if (!skill) return yield* Effect.die(new Error(`Built-in skill "${name}" not found`))
  const files = { "SKILL.md": skill.content, ...skill.files }
  const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 16)
  const dir = path.join(root, "skills", name, hash)
  for (const [file, body] of Object.entries(files)) {
    const target = path.join(dir, file)
    if ((yield* fs.readFileStringSafe(target)) === body) continue
    yield* fs.ensureDir(path.dirname(target))
    // Publish complete files so concurrent sessions never read a partial reference.
    const temp = path.join(root, `skill-${crypto.randomUUID()}.tmp`)
    yield* fs
      .writeWithDirs(temp, body)
      .pipe(
        Effect.andThen(fs.rename(temp, target)),
        Effect.ensuring(fs.remove(temp, { force: true }).pipe(Effect.orDie)),
      )
  }
  return dir
})
