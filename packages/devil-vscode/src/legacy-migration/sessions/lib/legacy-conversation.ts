import * as path from "node:path"
import * as vscode from "vscode"
import type { LegacyApiMessage } from "./legacy-types"

export async function getApiConversationHistory(id: string, dir: string) {
  const file = path.join(dir, id, "api_conversation_history.json")
  return vscode.workspace.fs.readFile(vscode.Uri.file(file))
}

export function parseFile(file: Uint8Array): LegacyApiMessage[] {
  const text = Buffer.from(file).toString("utf8")
  const json = JSON.parse(text) as unknown
  if (!Array.isArray(json)) {
    throw new Error("Legacy conversation history must be a JSON array")
  }
  return json.filter((entry): entry is LegacyApiMessage => Boolean(entry && typeof entry === "object"))
}
