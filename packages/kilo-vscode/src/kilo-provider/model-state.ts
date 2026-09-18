/**
 * Model selection persistence in the CLI state directory.
 *
 * Per-mode choices use the shared model.json. The explicit preferred combo uses
 * vscode-model.json so CLI/TUI writers cannot discard extension-only state.
 */

import * as fs from "fs"
import * as path from "path"
import { randomUUID } from "crypto"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { validateModelSelections } from "../provider-actions"

type PostMessage = (msg: unknown) => void

let cached: string | undefined
let queue: Promise<void> = Promise.resolve()

async function resolve(client: KiloClient | null): Promise<string | undefined> {
  if (cached) return cached
  if (!client) return undefined
  try {
    const resp = await client.path.get()
    if (typeof resp?.data?.state !== "string" || !resp.data.state) return undefined
    cached = resp.data.state
    return cached
  } catch {
    return undefined
  }
}

async function read(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(file, "utf-8")
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function selection(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  if (
    typeof value.providerID !== "string" ||
    !value.providerID ||
    typeof value.modelID !== "string" ||
    !value.modelID ||
    (value.variant !== undefined && typeof value.variant !== "string")
  ) {
    return undefined
  }
  return {
    providerID: value.providerID,
    modelID: value.modelID,
    ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
  }
}

function write(
  client: KiloClient | null,
  update: (data: Record<string, unknown>) => void,
  preferred?: ReturnType<typeof selection>,
): Promise<void> {
  const op = queue.then(async () => {
    const dir = await resolve(client)
    if (!dir) return
    const file = path.join(dir, "model.json")
    const existing = await read(file)
    update(existing)
    await fs.promises.writeFile(file, JSON.stringify(existing, null, 2))
    const target = path.join(dir, "vscode-model.json")
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await fs.promises.writeFile(temp, JSON.stringify({ preferred }, null, 2))
      await fs.promises.rename(temp, target)
    } finally {
      await fs.promises.rm(temp, { force: true }).catch((err) => {
        console.error("[Kilo New] Failed to remove temporary model preferences:", err)
      })
    }
  })
  queue = op.catch((err) => {
    console.error("[Kilo New] Failed to persist model selections:", err)
  })
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
    const preferred = selection(message)
    const agent = message.agent
    if (!preferred || typeof agent !== "string" || !agent) return true
    await write(
      client,
      (data) => {
        const model = validateModelSelections(data.model)
        model[agent] = { providerID: preferred.providerID, modelID: preferred.modelID }
        data.model = model
      },
      { ...preferred, variant: preferred.variant ?? "" },
    )
    return true
  }
  if (type === "requestModelSelections") {
    await queue
    const dir = await resolve(client)
    if (!dir) return true
    const [data, prefs] = await Promise.all([
      read(path.join(dir, "model.json")),
      read(path.join(dir, "vscode-model.json")),
    ])
    const selections = validateModelSelections(data.model)
    const preferred = selection(prefs.preferred)
    post({ type: "modelSelectionsLoaded", selections, ...(preferred ? { preferred } : {}) })
    return true
  }
  return false
}

export async function reset(client: KiloClient | null, post: PostMessage): Promise<void> {
  await write(client, (data) => {
    data.model = {}
  })
  post({ type: "modelSelectionsLoaded", selections: {} })
}
