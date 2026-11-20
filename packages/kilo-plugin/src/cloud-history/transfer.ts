import { KiloNativeMessage } from "@kilocode/gateway-core"
import { KiloCloudHistoryRpc } from "@opencode/schema/kilocode/cloud-history"
import type { Location } from "@opencode/schema/location"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Schema } from "effect"
import { Blob, CloudError, decode, invalid, type BlobReader, type Entity } from "./reader"

const record = KiloNativeMessage.object
const Mapping = Schema.Struct({
  entity: Schema.Struct({ kind: Schema.String, id: Schema.String }),
  pointer: Schema.String,
  reference: Schema.String,
  blob: Blob,
  mime: Schema.optional(Schema.String),
})
type Mapping = typeof Mapping.Type

/** Only transcript state travels: the local destination, permission policy and future work belong to the importing device. */
export async function transfer(
  snapshot: { sessionID: string; entities: Entity[]; position: number; blob: BlobReader },
  location: Pick<Location.Info, "directory" | "project">,
) {
  const info = snapshot.entities.find((e) => e.kind === "session" && e.id === snapshot.sessionID)?.value
  if (!record(info) || info.id !== snapshot.sessionID) throw invalid()
  const assets = assetMappings(snapshot.entities)
  const parts = new Map<string, Schema.Json[]>()
  for (const e of snapshot.entities.filter((e) => e.kind === "message-part")) {
    const v = e.value
    if (!record(v) || typeof v.messageID !== "string" || e.id !== `${v.messageID}/${v.ordinal}`) throw invalid()
    await restoreFiles(e, assets, snapshot.blob)
    const group = parts.get(v.messageID) ?? []
    group.push(v)
    parts.set(v.messageID, group)
  }
  const rows = []
  for (const e of snapshot.entities.filter((e) => e.kind === "message")) {
    await restoreFiles(e, assets, snapshot.blob)
    const siblings = parts.get(e.id) ?? []
    if (siblings.length && (!record(e.value) || !e.value.parts)) throw invalid()
    const result = KiloNativeMessage.reconstructMessage(e.value, siblings, snapshot.position)
    parts.delete(e.id)
    rows.push(orderedMessage(result, e.id))
  }
  if (parts.size || new Set(rows.map((row) => row.seq)).size !== rows.length) throw invalid()
  rows.sort((a, b) => a.seq - b.seq)
  const ids = new Map(rows.map(({ message }) => [message.id, SessionMessage.ID.create()]))
  const messages = rows.map(({ message }) => detachMessage(message, ids))
  return decode(KiloCloudHistoryRpc.Transfer, {
    info: {
      id: Session.ID.create(),
      location: { directory: location.directory },
      projectID: location.project.id,
      ...(info.title !== undefined && { title: info.title }),
      ...(info.agent !== undefined && { agent: info.agent }),
      ...(info.model !== undefined && { model: info.model }),
      cost: info.cost,
      tokens: info.tokens,
      time: info.time,
    },
    messages,
  })
}

function assetMappings(entities: Entity[]) {
  const assets = new Map<string, Mapping>()
  for (const item of entities.filter((e) => e.kind === "asset")) {
    const mapping = decode(Mapping, item.value)
    const key = `${mapping.entity.kind}:${mapping.entity.id}:${mapping.pointer}`
    if (assets.has(key)) throw invalid()
    assets.set(key, mapping)
  }
  return assets
}

function orderedMessage(result: ReturnType<typeof KiloNativeMessage.reconstructMessage>, id: string) {
  if (
    !result.complete ||
    !record(result.value) ||
    !record(result.value.message) ||
    result.value.message.id !== id ||
    typeof result.value.seq !== "number" ||
    !Number.isSafeInteger(result.value.seq)
  )
    throw invalid()
  return { seq: result.value.seq, message: result.value.message }
}

function detachMessage(message: Record<string, Schema.Json>, ids: Map<Schema.Json | undefined, SessionMessage.ID>) {
  if (
    (message.type === "assistant" && (!record(message.time) || message.time.completed == null)) ||
    ((message.type === "shell" || message.type === "compaction") && message.status === "running")
  )
    throw invalid()
  const { snapshot: _, ...detached } = message
  const meta = message.metadata
  if (message.type === "compaction" && record(meta) && meta.keepID !== undefined) {
    const keepID = ids.get(meta.keepID)
    if (!keepID) throw invalid()
    return { ...detached, id: ids.get(message.id), metadata: { ...meta, keepID } }
  }
  return { ...detached, id: ids.get(message.id) }
}

async function restoreFiles(e: Entity, assets: Map<string, Mapping>, read: BlobReader) {
  if (!record(e.value)) throw invalid()
  const load = async (file: Record<string, Schema.Json>, pointer: string) => {
    const m = assets.get(`${e.kind}:${e.id}:${pointer}`)
    if (
      !m ||
      m.reference !== file.uri ||
      m.mime !== file.mime ||
      (m.reference.startsWith("media:") && m.reference !== `media:${m.blob.hash}`)
    )
      throw invalid()
    return (await read(m.blob)).toString("base64")
  }
  const message = e.value.message
  if (record(message) && Array.isArray(message.files)) {
    for (const [index, file] of message.files.entries()) {
      if (!record(file)) throw invalid()
      if (typeof file.data !== "string") file.data = await load(file, `/message/files/${index}`)
      file.source = { type: "inline" }
      delete file.uri
    }
  }
  const parts =
    e.kind === "message-part"
      ? [{ part: e.value.part, path: "/part" }]
      : record(message) && Array.isArray(message.content)
        ? message.content.map((part, i) => ({ part, path: `/message/content/${i}` }))
        : []
  for (const { part, path } of parts) await restoreToolFiles(part, path, load)
}

async function restoreToolFiles(
  part: Schema.Json | undefined,
  path: string,
  load: (file: Record<string, Schema.Json>, pointer: string) => Promise<string>,
) {
  if (!record(part) || part.type !== "tool" || !record(part.state)) return
  if (record(part.state.metadata) && part.state.metadata.outputPath)
    throw new CloudError("This transcript references an external tool output file and cannot be imported in full.")
  if (!Array.isArray(part.state.content)) return
  for (const [i, file] of part.state.content.entries()) {
    if (!record(file) || file.type !== "file") continue
    if (typeof file.uri === "string" && file.uri.startsWith("data:")) continue
    file.uri = `data:${file.mime};base64,${await load(file, `${path}/state/content/${i}`)}`
  }
}
