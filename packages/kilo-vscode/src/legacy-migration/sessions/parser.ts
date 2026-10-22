import type { LegacyApiMessage, LegacyHistoryItem } from "./lib/legacy-types"
import type {
  KilocodeSessionImportMessageData as Message,
  KilocodeSessionImportPartData as Part,
  KilocodeSessionImportProjectData as Project,
  KilocodeSessionImportSessionData as Session,
} from "@kilocode/sdk/v2"
import { getApiConversationHistory, parseFile } from "./lib/legacy-conversation"
import { parseMessagesFromConversation } from "./lib/messages"
import { parsePartsFromConversation } from "./lib/parts/parts"
import { normalizeLegacyPath } from "./lib/path"
import { createProject } from "./lib/project"
import { createSession } from "./lib/session"

export interface NormalizedSession {
  project: NonNullable<Project["body"]>
  session: NonNullable<Session["body"]>
  messages: Array<NonNullable<Message["body"]>>
  parts: Array<NonNullable<Part["body"]>>
}

export async function parseSession(
  id: string,
  dir: string,
  item?: LegacyHistoryItem,
  input?: LegacyApiMessage[],
  key = id,
): Promise<NormalizedSession> {
  const root = await normalizeLegacyPath(item?.workspace)
  const next = item ? { ...item, workspace: root } : undefined
  const project = createProject(next)
  const session = createSession(id, next, project.id, root, key)
  const conversation = input ?? parseFile(await getApiConversationHistory(id, dir))
  const messages = parseMessagesFromConversation(conversation, key, root, next)
  const parts = parsePartsFromConversation(conversation, key, item)

  return {
    project,
    session,
    messages,
    parts,
  }
}
