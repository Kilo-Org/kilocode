import { lstatSync, readdirSync } from "node:fs"
import path from "node:path"
import { projectDirectories } from "./project-config"
import { legacyRoots } from "./resource-roots"

const resources = [
  "kilo.json",
  "kilo.jsonc",
  "cli.json",
  "AGENTS.md",
  "agent-manager.json",
  "skill",
  "skills",
  "workflows",
  "agent",
  "agents",
  "mode",
  "modes",
  "command",
  "commands",
  "rules",
  "plugin",
  "plugins",
  "themes",
]

/** Report filenames only, before any profile initialization. Do not parse credentials, traverse skill
 * bundles, or create an empty DB to make a resource-only profile look ready for the session importer. */
export function checkResourceOnly(
  plan: {
    home: string
    configBase: string
    legacyConfig: string
    legacyConfigFile?: string
    v1State: string
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
  for (const config of new Set([plan.legacyConfig, path.join(plan.configBase, "kilo")])) {
    const entry = lstatSync(config, { throwIfNoEntry: false })
    if (!entry?.isDirectory()) {
      if (entry) found.add(config)
      continue
    }
    for (const name of readdirSync(config)) add(path.join(config, name))
  }
  if (plan.legacyConfigFile) add(plan.legacyConfigFile)
  add(path.join(plan.legacyData, "auth.json"))
  add(path.join(plan.home, ".kilocode", ".kilocodeignore"))
  add(path.join(plan.v1State, "model.json"))
  for (const file of modes) add(file)
  const dirs = new Set(dot)
  for (const dir of projectDirectories([cwd])) {
    for (const name of ["kilo.json", "kilo.jsonc", ".kilocodeignore"]) add(path.join(dir, name))
    for (const name of [".kilo", ".kilocode"]) dirs.add(path.join(dir, name))
  }
  for (const dir of dirs) for (const name of resources) add(path.join(dir, name))
  for (const dir of storage) for (const name of ["skills", "workflows"]) add(path.join(dir, name))
  if (found.size)
    throw new Error(
      `V1 resources exist without a session database at ${plan.source}. This pilot cannot migrate a resource-only profile. Keep using your existing profile until these paths are reconciled:\n${[...found].sort().join("\n")}`,
    )
}
