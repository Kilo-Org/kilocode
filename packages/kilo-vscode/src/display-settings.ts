// Reads the effective Kilo display layouts for the chat view. The config API drops Kilo-only keys, so the host asks
// the server which config documents apply, reads them in priority order and lets `displaySettings` pick each value.
import { readFile } from "node:fs/promises"
import { displaySettings, type PolicyDocument } from "./config-policy"
import { local } from "./local"
import type { DisplaySettings } from "./protocol"

type Entry = { type: "document" | "directory"; path?: string }

export async function readDisplaySettings(input: {
  server: { url: string; authorization: string }
  directory: string
}): Promise<DisplaySettings> {
  const query = new URLSearchParams({ "location[directory]": input.directory })
  const response = await local(new URL(`/api/config?${query}`, input.server.url), {
    headers: { authorization: input.server.authorization },
  })
  const entries = (await response.json()) as Entry[]
  const documents: PolicyDocument[] = []
  // A document that is not readable JSON, such as a managed preference plist, contributes nothing.
  for (const entry of entries) {
    if (entry.type !== "document" || !entry.path) continue
    documents.push({ path: entry.path, text: await readFile(entry.path, "utf8").catch(() => "") })
  }
  return displaySettings(documents)
}
