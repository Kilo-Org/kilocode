import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { getMigrationErrorMessage } from "../errors/migration-error"
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

export async function migrate(id: string, context: vscode.ExtensionContext, client: KiloClient): Promise<Result> {
  const dir = vscode.Uri.joinPath(context.globalStorageUri, "tasks").fsPath
  const items = context.globalState.get<LegacyHistoryItem[]>("taskHistory", [])
  const item = items.find((item) => item.id === id)
  const payload = await parseSession(id, dir, item)

  try {
    const project = await client.kilocode.sessionImport.project(payload.project, { throwOnError: true })
    const projectID = project.data?.id ?? payload.project.id
    const session = await client.kilocode.sessionImport.session(
      {
        ...payload.session,
        projectID,
        query_directory: payload.session.directory,
        body_directory: payload.session.directory,
      },
      { throwOnError: true },
    )
    // Skip child imports when the session already exists so rerunning migration only imports missing sessions.
    if (session.data?.skipped) {
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

    return {
      ok: true,
      payload,
    }
  } catch (error) {
    return {
      ok: false,
      payload,
      message: getMigrationErrorMessage(error),
    }
  }
}
