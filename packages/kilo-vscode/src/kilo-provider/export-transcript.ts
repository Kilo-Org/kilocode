import * as path from "path"
import * as vscode from "vscode"
import type { KiloClient, Message, Part, Session } from "@kilocode/sdk/v2/client"
import { fetchMessagePage } from "./message-page"

type Item = {
  info: Message
  parts: Part[]
}

export async function exportTranscript(
  client: KiloClient,
  input: {
    sessionID: string
    dir: string
  },
) {
  const [{ data: session }, page] = await Promise.all([
    client.session.get({ sessionID: input.sessionID, directory: input.dir }, { throwOnError: true }),
    fetchMessagePage(client, { sessionID: input.sessionID, workspaceDir: input.dir, limit: 0 }),
  ])
  const text = formatTranscript(session, page.items)
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(input.dir, `session-${session.id.slice(0, 8)}.md`)),
    filters: { Markdown: ["md", "markdown"] },
    saveLabel: "Export",
  })
  if (!uri) return false
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"))
  return true
}

export function formatTranscript(session: Session, items: Item[]): string {
  const head = [
    `# ${session.title}`,
    "",
    `**Session ID:** ${session.id}`,
    `**Created:** ${new Date(session.time.created).toLocaleString()}`,
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}`,
    "",
    "---",
    "",
    "",
  ].join("\n")
  const body = items.map((item) => formatMessage(item)).join("---\n\n")
  return `${head}${body}${items.length > 0 ? "---\n\n" : ""}`
}

function formatMessage(item: Item): string {
  const head = item.info.role === "user" ? "## User\n\n" : "## Assistant\n\n"
  return `${head}${item.parts.map((part) => formatPart(part)).join("")}`
}

function formatPart(part: Part): string {
  if (part.type === "text" && !part.synthetic) return `${part.text}\n\n`
  if (part.type === "tool") return `**Tool: ${part.tool}**\n\n`
  return ""
}
