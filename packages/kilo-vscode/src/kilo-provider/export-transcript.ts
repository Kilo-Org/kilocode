import path from "node:path"
import { OpenCode, type OpenCodeClient, type SessionMessageInfo } from "@opencode/client"
import { Uri, window, workspace } from "vscode"
import { getErrorMessage } from "../agent-manager/errors"
import { local } from "../local"
import type { Manager } from "../server"
import { t } from "../services/i18n"
import { formatSessionTranscript } from "../session-transcript"

export async function exportTranscript(server: Manager, sessionID: string) {
  try {
    const target = await server.get()
    const client = OpenCode.make({
      baseUrl: target.url,
      headers: { authorization: target.authorization },
      fetch: local,
    })
    const [info, messages] = await Promise.all([client.session.get({ sessionID }), sessionMessages(client, sessionID)])
    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(path.join(info.location.directory, `session-${info.id.slice(0, 8)}.md`)),
      filters: { Markdown: ["md", "markdown"] },
      saveLabel: t("session.export.save"),
    })
    if (!uri) return
    await workspace.fs.writeFile(uri, Buffer.from(formatSessionTranscript({ info, messages }), "utf8"))
    void window.showInformationMessage(t("session.export.success"))
  } catch (error) {
    const message = t("session.export.error")
    const detail = getErrorMessage(error)
    console.error(`[Kilo] ${message}:`, error)
    void window.showErrorMessage(detail ? `${message}: ${detail}` : message)
  }
}

async function sessionMessages(client: OpenCodeClient, sessionID: string) {
  const messages: SessionMessageInfo[] = []
  const limit = 200
  let cursor: string | undefined
  // Start at the latest stored message and walk back. The transfer API would omit the active assistant step.
  do {
    const page = await client.message.list({ sessionID, limit, cursor, order: cursor ? undefined : "desc" })
    messages.push(...page.data)
    if (page.data.length < limit) break
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  return messages.reverse()
}
