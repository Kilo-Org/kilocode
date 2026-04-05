import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { getMigrationErrorMessage } from "../errors/migration-error"
import type { MigrationSessionInfo, MigrationSessionProgress, MigrationSessionSelection } from "../legacy-types"
import type { LegacyHistoryItem } from "./lib/legacy-types"
import { parseSession } from "./parser"

type Result =
  | {
      ok: true
      skipped?: boolean
      payload: Awaited<ReturnType<typeof parseSession>>
    }
  | {
      ok: false
      payload: Awaited<ReturnType<typeof parseSession>>
      message: string
    }

type Progress = Omit<MigrationSessionProgress, "session" | "index" | "total">
type ProgressCallback = (progress: Progress) => void

function trimError(input: string) {
  return input.length <= 100 ? input : `${input.slice(0, 100)}...`
}

export async function migrate(
  input: MigrationSessionSelection,
  context: vscode.ExtensionContext,
  client: KiloClient,
  meta?: {
    session: MigrationSessionInfo
    index: number
    total: number
  },
  onProgress?: ProgressCallback,
): Promise<Result> {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, "tasks").fsPath
  const items = context.globalState.get<LegacyHistoryItem[]>("taskHistory", [])
  const item = items.find((item) => item.id === input.id)
  const payload = await parseSession(input.id, dir, item)

  const progress = (next: Progress) => {
    if (!meta || !onProgress) return
    onProgress(next)
  }

  try {
    progress({ phase: "project" })
    const project = await client.kilocode.sessionImport.project(payload.project, { throwOnError: true })
    const projectID = project.data?.id ?? payload.project.id
    progress({ phase: "session" })
    const session = await client.kilocode.sessionImport.session(
      {
        ...payload.session,
        projectID,
        query_directory: payload.session.directory,
        body_directory: payload.session.directory,
        ...(input.force ? { force: true } : {}),
      },
      { throwOnError: true },
    )
    // Skip child imports when the session already exists so rerunning migration only imports missing sessions.
    if (session.data?.skipped) {
      progress({ phase: "skipped" })
      return {
        ok: true,
        skipped: true,
        payload,
      }
    }

    progress({ phase: "messages", current: 0, count: payload.messages.length })
    for (const [index, msg] of payload.messages.entries()) {
      await client.kilocode.sessionImport.message(msg, { throwOnError: true })
      progress({ phase: "messages", current: index + 1, count: payload.messages.length })
    }

    progress({ phase: "parts", current: 0, count: payload.parts.length })
    for (const [index, part] of payload.parts.entries()) {
      await client.kilocode.sessionImport.part(part, { throwOnError: true })
      progress({ phase: "parts", current: index + 1, count: payload.parts.length })
    }

    progress({ phase: "done" })

    return {
      ok: true,
      payload,
    }
  } catch (error) {
    progress({
      phase: "error",
      error: trimError(getMigrationErrorMessage(error)),
    })
    return {
      ok: false,
      payload,
      message: getMigrationErrorMessage(error),
    }
  }
}
