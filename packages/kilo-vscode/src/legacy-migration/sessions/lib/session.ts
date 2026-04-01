import type { KilocodeSessionImportSessionData as Session } from "@kilocode/sdk/v2"
import type { LegacyHistoryItem } from "./legacy-types"
import { createSessionID } from "./ids"

export function createSession(
  id: string,
  item: LegacyHistoryItem | undefined,
  projectID: string,
  dir: string,
): NonNullable<Session["body"]> {
  const session = makeSession()

  session.id = createSessionID(id)

  session.projectID = projectID

  session.slug = id

  session.directory = dir

  session.title = item?.task ?? id

  session.version = "v2"

  session.timeCreated = item?.ts ?? 0

  session.timeUpdated = item?.ts ?? 0

  return session
}

function makeSession(): NonNullable<Session["body"]> {
  return {
    id: "",
    projectID: "",
    slug: "",
    directory: "",
    title: "",
    version: "",
    timeCreated: 0,
    timeUpdated: 0,
  }
}
