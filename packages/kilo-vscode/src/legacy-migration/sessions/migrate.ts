import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { getMigrationErrorMessage } from "../errors/migration-error"
import type { MigrationSessionInfo, MigrationSessionProgress, MigrationSessionSelection } from "../legacy-types"
import { createSessionID } from "./lib/ids"
import type { LegacyHistoryItem } from "./lib/legacy-types"
import { parseSession } from "./parser"

type Result =
  | {
      ok: true
      skipped?: boolean
      payload?: Awaited<ReturnType<typeof parseSession>>
    }
  | {
      ok: false
      payload?: Awaited<ReturnType<typeof parseSession>>
      message: string
    }

type Progress = Omit<MigrationSessionProgress, "session" | "index" | "total">
type ProgressCallback = (progress: Progress) => void
type Payload = Awaited<ReturnType<typeof parseSession>>

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

  const progress = (next: Progress) => {
    if (!meta || !onProgress) return
    onProgress(next)
  }

  const skip = () => {
    progress({ phase: "skipped" })
    return {
      ok: true as const,
      skipped: true,
    }
  }

  const fail = (error: unknown, payload?: Payload) => {
    progress({
      phase: "error",
      error: trimError(getMigrationErrorMessage(error)),
    })
    return {
      ok: false as const,
      ...(payload ? { payload } : {}),
      message: getMigrationErrorMessage(error),
    }
  }

  try {
    if (!input.force) {
      const result = await client.session.get({ sessionID: createSessionID(input.id) })
      if (result.data) return skip()
    }

    progress({ phase: "preparing" })
    const payload = await parseSession(input.id, dir, item)
    progress({ phase: "storing" })
    const project = await client.kilocode.sessionImport.project(payload.project, { throwOnError: true })
    const projectID = project.data?.id ?? payload.project.id
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

    for (const msg of payload.messages) {
      await client.kilocode.sessionImport.message(msg, { throwOnError: true })
    }

    for (const part of payload.parts) {
      await client.kilocode.sessionImport.part(part, { throwOnError: true })
    }

    progress({ phase: "done" })

    return {
      ok: true,
      payload,
    }
  } catch (error) {
    return fail(error)
  }
}
