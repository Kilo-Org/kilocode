// The server half of the slash menu: `command.list` and `skill.list` of one location, from the per-location cache of
// createData. Kept free of JSX and webview contexts, so the extension tests can load it.
import type { CommandInfo, SkillInfo } from "@opencode/client"

type Resource<T> = {
  list: () => readonly T[] | undefined
  sync: () => Promise<void>
  invalidate: () => void
}

/**
 * Loads the commands and skills of the location and keeps them current. createData reloads the command list on
 * `command.updated`; the server sends no skill event, and a config change can add or remove both, so the skills
 * reload on `command.updated` and both lists reload on `config.updated`. Returns the unsubscribe function.
 */
export function createSlashCatalog(input: {
  command: Resource<CommandInfo>
  skill: Resource<SkillInfo>
  on: (type: "command.updated" | "config.updated", handler: () => void) => () => void
  report: (error: unknown) => void
}) {
  const state = { loaded: false }
  const refresh = (resources: Resource<unknown>[]) => {
    for (const resource of resources) resource.invalidate()
    if (!state.loaded) return Promise.resolve()
    return Promise.all(resources.map((resource) => resource.sync())).then(() => undefined, input.report)
  }
  const stops = [
    input.on("command.updated", () => void refresh([input.skill])),
    input.on("config.updated", () => void refresh([input.command, input.skill])),
  ]
  return {
    commands: () => input.command.list() ?? [],
    skills: () => input.skill.list() ?? [],
    /** Loads both lists once per invalidation; later events keep them current. */
    load() {
      state.loaded = true
      return Promise.all([input.command.sync(), input.skill.sync()]).then(() => undefined, input.report)
    },
    dispose: () => stops.forEach((stop) => stop()),
  }
}
