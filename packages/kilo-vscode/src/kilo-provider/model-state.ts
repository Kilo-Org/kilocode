/**
 * Per-mode model selection persistence via the CLI's model.json.
 *
 * Reads/writes ~/.local/state/kilo/model.json (same file the CLI TUI uses)
 * so per-mode model choices are shared between CLI and extension.
 */

import * as fs from "fs"
import * as path from "path"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { validateModelSelections } from "../provider-actions"

type PostMessage = (msg: unknown) => void

let cached: string | undefined
let queue: Promise<void> = Promise.resolve()

async function resolve(client: KiloClient | null): Promise<string | undefined> {
  if (cached) return cached
  try {
    const resp = await client?.path.get()
    if (!resp?.data?.state) return undefined
    cached = path.join(resp.data.state, "model.json")
    return cached
  } catch {
    return undefined
  }
}

async function read(client: KiloClient | null): Promise<Record<string, unknown>> {
  const p = await resolve(client)
  if (!p) return {}
  try {
    const raw = await fs.promises.readFile(p, "utf-8")
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function write(client: KiloClient | null, key: string, value: unknown): Promise<void> {
  const op = queue.then(async () => {
    const p = await resolve(client)
    if (!p) return
    const existing = await read(client)
    existing[key] = value
    await fs.promises.writeFile(p, JSON.stringify(existing, null, 2))
  })
  queue = op.catch(() => {})
  return op
}

/**
 * Handle a model-state webview message. Returns true if handled.
 */
export async function handleMessage(
  type: string,
  message: Record<string, unknown>,
  client: KiloClient | null,
  post: PostMessage,
): Promise<boolean> {
  if (type === "persistModelSelection") {
    const data = await read(client)
    const model = validateModelSelections(data.model)
    model[message.agent as string] = {
      providerID: message.providerID as string,
      modelID: message.modelID as string,
    }
    await write(client, "model", model)
    return true
  }
  if (type === "clearModelSelection") {
    const data = await read(client)
    const model = validateModelSelections(data.model)
    delete model[message.agent as string]
    await write(client, "model", model)
    return true
  }
  if (type === "requestModelSelections") {
    const data = await read(client)
    const selections = validateModelSelections(data.model)
    post({ type: "modelSelectionsLoaded", selections })
    return true
  }
  return false
}

export async function reset(client: KiloClient | null, post: PostMessage): Promise<void> {
  await write(client, "model", {})
  post({ type: "modelSelectionsLoaded", selections: {} })
}
