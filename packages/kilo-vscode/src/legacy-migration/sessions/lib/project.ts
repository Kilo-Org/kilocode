import type { KilocodeSessionImportProjectData as Project } from "@kilocode/sdk/v2"
import type { LegacyHistoryItem } from "./legacy-types"
import { createProjectID } from "./ids"

export function createProject(item?: LegacyHistoryItem): NonNullable<Project["body"]> {
  const project = makeProject()
  const dir = item?.workspace ?? ""

  project.id = createProjectID(dir)

  project.worktree = dir

  project.sandboxes = dir ? [dir] : []

  project.timeCreated = item?.ts ?? 0

  project.timeUpdated = item?.ts ?? 0

  return project
}

function makeProject(): NonNullable<Project["body"]> {
  return {
    id: "",
    worktree: "",
    sandboxes: [],
    timeCreated: 0,
    timeUpdated: 0,
  }
}
