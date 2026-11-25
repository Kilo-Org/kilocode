import { lstatSync, readdirSync } from "node:fs"
import path from "node:path"
import { projectDirectories } from "./project-config"
import { legacyRoots } from "./resource-roots"

/** Report filenames only, before any profile initialization. Do not parse credentials, traverse skill
 * bundles, or create an empty DB to make a resource-only profile look ready for the session importer. */
export function checkResourceOnly(
  plan: {
    home: string
    configBase: string
    legacyConfig: string
    legacyConfigFile?: string
    v1State: string
    legacyState: string
    legacyData: string
    source: string
  },
  cwd: string,
) {
  const { dot, storage, modes } = legacyRoots(plan.home, plan.configBase)
  const found = new Set<string>()
  function add(file: string) {
    const entry = lstatSync(file, { throwIfNoEntry: false })
    if (!entry) return
    if (!entry.isDirectory()) {
      found.add(file)
      return
    }
    for (const name of readdirSync(file)) found.add(path.join(file, name))
  }
  // Stable config files, file-based skills/commands and auth.json are consumed directly at native bootstrap.
  const defaultConfig = path.join(plan.configBase, "kilo")
  if (defaultConfig !== plan.legacyConfig) {
    // Without a database there is no accepted conversion to copy an additional config root.
    for (const name of [
      "kilo.json",
      "kilo.jsonc",
      "AGENTS.md",
      "skill",
      "skills",
      "command",
      "commands",
      "agent",
      "agents",
      "plugins",
    ])
      add(path.join(defaultConfig, name))
  }
  add(path.join(plan.home, ".kilocode", ".kilocodeignore"))
  if (plan.v1State !== plan.legacyState) add(path.join(plan.v1State, "model.json"))
  for (const file of modes) add(file)
  for (const dir of dot) {
    if (dir === plan.legacyConfig || dir === path.join(plan.configBase, "kilo")) continue
    for (const name of ["skill", "skills", "workflows", "modes"]) add(path.join(dir, name))
  }
  for (const root of new Set([plan.legacyConfig, path.join(plan.configBase, "kilo")])) add(path.join(root, "workflows"))
  for (const dir of projectDirectories([cwd])) {
    add(path.join(dir, ".kilocodeignore"))
    for (const name of [".kilocode/skills", ".kilocode/workflows", ".kilo/workflows"]) add(path.join(dir, name))
  }
  for (const dir of storage) for (const name of ["skills", "workflows"]) add(path.join(dir, name))
  if (found.size)
    throw new Error(
      `V1 resources exist without a session database at ${plan.source}. This pilot cannot migrate a resource-only profile. Keep using your existing profile until these paths are reconciled:\n${[...found].sort().join("\n")}`,
    )
}
