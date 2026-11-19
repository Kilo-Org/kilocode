import { createHash } from "node:crypto"
import type { KiloAccount } from "@kilocode/gateway-core"
import { HostedAttachments } from "@opencode/schema/kilocode/hosted-attachments"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError, invalid } from "./error"
import { json, responseError } from "./transport"
import type { createCatalog } from "./catalog"

const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const Grant = Schema.Struct({ signedUrl: Schema.String, key: Schema.String, expiresAt: Schema.String })
const Ack = Schema.Struct({
  cloudAgentSessionId: Schema.String,
  messageId: Schema.String,
  status: Schema.Literal("started"),
  delivery: Schema.Literals(["queued", "sent"]),
})
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }
type Staged = { digest: string; handle: string; stored: Promise<string> }
type Batch = { path: string; expires: number; files: Map<string, Staged>; intent?: string }
export type ImageTurn = {
  messageID: string
  text: string
  attachments: readonly string[]
  agent?: string
  model?: string
  variant?: string
}

function objectGrant(raw: unknown, issuer: string, batch: string, mime: HostedAttachments.Image["mime"]) {
  if (!Schema.is(Grant)(raw) || !(Date.parse(raw.expiresAt) > Date.now())) return invalid()
  const file = raw.key.split("/").at(-1) ?? ""
  const stem = file.slice(0, file.lastIndexOf("."))
  if (
    !Schema.is(Schema.String.check(Schema.isUUID()))(stem) ||
    file !== `${stem}.${extensions[mime]}` ||
    !raw.key.endsWith(`/cloud-agent/${batch}/${file}`)
  )
    return invalid()
  const url = new URL(raw.signedUrl)
  // A production presign grants a single PUT to Cloud's R2. Test issuers can serve their own loopback objects.
  const fixture =
    url.origin === issuer && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  const r2 =
    url.protocol === "https:" &&
    !url.port &&
    /^(?:[a-z0-9.-]+\.)?[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname)
  if (
    (!fixture && !r2) ||
    url.username ||
    url.password ||
    url.hash ||
    !decodeURIComponent(url.pathname).endsWith(`/${raw.key}`) ||
    !url.searchParams.get("X-Amz-Signature")
  )
    return invalid()
  return { url, key: raw.key, file }
}

export async function createWithImages(
  input: KiloHostedRpc.Create,
  catalog: ReturnType<typeof createCatalog>,
  uploads: ReturnType<typeof createAttachments>,
  signal: AbortSignal,
) {
  if (!input.attachments) return catalog.create(input, signal)
  const { attachments, messageID, prompt, ...workspace } = input
  if (!messageID || prompt === undefined) throw new HostedError("Cloud images require a message ID.")
  await uploads.verify(messageID, attachments)
  // The native workspace mutation does not finalize pending uploads. Create an empty workspace,
  // then dispatch its actual first turn through the same linking transaction as the Cloud composer.
  const created = await catalog.create(workspace, signal)
  const control = await catalog.authorize(created.target, signal)
  await uploads.send(
    created.target,
    control,
    {
      messageID,
      text: prompt,
      attachments,
      agent: input.agent.mode,
      model: input.agent.model,
      variant: input.agent.variant,
    },
    signal,
  )
  return created
}

/** Per-account/location upload handles. No object keys, grants, image bytes, or bearer tokens enter session snapshots. */
export function createAttachments(account: KiloAccount.Info, issuer: string) {
  const batches = new Map<string, Batch>()
  async function web(
    method: "getAttachmentUploadUrl" | "releasePendingUploads" | "sendMessage",
    input: object,
    signal: AbortSignal,
  ) {
    const org = account.organizationID
    const prefix = org ? "organizations.cloudAgentNext" : "cloudAgentNext"
    const response = await fetch(`${issuer}/api/trpc/${prefix}.${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(org ? { ...input, organizationId: org } : input),
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!response.ok) return responseError(response)
    const env = await json(response, 64 * 1024)
    if (!Schema.is(Envelope)(env)) return invalid()
    return env.result.data
  }
  async function upload(
    path: string,
    id: string,
    mime: HostedAttachments.Image["mime"],
    bytes: Buffer,
    signal: AbortSignal,
  ) {
    const raw = await web(
      "getAttachmentUploadUrl",
      { messageUuid: path, attachmentId: id, contentType: mime, contentLength: bytes.byteLength },
      signal,
    )
    const grant = objectGrant(raw, issuer, path, mime)
    try {
      const response = await fetch(grant.url, {
        method: "PUT",
        body: new Uint8Array(bytes),
        headers: { "Content-Type": mime, "Content-Length": String(bytes.byteLength) },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      })
      await response.body?.cancel()
      if (!response.ok) throw new HostedError("Cloud image upload failed.")
      return grant.file
    } catch {
      // Only release our pending upload, before any dispatch. An ambiguous send must keep its linked objects.
      await web("releasePendingUploads", { objectKeys: [grant.key] }, AbortSignal.timeout(5000)).catch(() => {})
      throw new HostedError("Cloud image upload failed.")
    }
  }
  function select(messageID: string, handles: readonly string[]) {
    const batch = batches.get(messageID)
    if (!batch || batch.expires < Date.now() || !handles.length || new Set(handles).size !== handles.length)
      throw new HostedError("Cloud attachment expired. Add the image again.")
    const files = handles.map((handle) => {
      const file = Array.from(batch.files.values()).find((f) => f.handle === handle)
      if (!file) throw new HostedError("Cloud attachment does not belong to this message.")
      return file.stored
    })
    return { batch, files }
  }
  return {
    async stage(messageID: string, image: HostedAttachments.Image, signal: AbortSignal) {
      const bytes = Buffer.from(image.base64, "base64")
      if (
        !bytes.byteLength ||
        bytes.byteLength > HostedAttachments.MAX_BYTES ||
        bytes.toString("base64") !== image.base64
      )
        throw new HostedError("Invalid Cloud image.")
      for (const [key, b] of batches) if (b.expires <= Date.now()) batches.delete(key)
      if (batches.size >= 128 && !batches.has(messageID)) throw new HostedError("Too many pending Cloud messages.")
      const batch = batches.get(messageID) ?? {
        path: crypto.randomUUID(),
        expires: Date.now() + 60 * 60_000,
        files: new Map<string, Staged>(),
      }
      batches.set(messageID, batch)
      const digest = createHash("sha256").update(image.mime).update(bytes).digest("hex")
      const prior = batch.files.get(image.id)
      if (prior) {
        if (prior.digest !== digest) throw new HostedError("Cloud image changed. Start a new message.")
        await prior.stored
        return { handle: prior.handle }
      }
      if (batch.files.size >= 5 || batch.intent)
        throw new HostedError("Cloud attachment set cannot be changed for this message.")
      const file = {
        digest,
        handle: crypto.randomUUID(),
        stored: upload(batch.path, image.id, image.mime, bytes, signal),
      }
      batch.files.set(image.id, file)
      try {
        await file.stored
        return { handle: file.handle }
      } catch (error) {
        batch.files.delete(image.id)
        throw error
      }
    },
    async verify(messageID: string, handles: readonly string[]) {
      await Promise.all(select(messageID, handles).files)
    },
    async send(target: KiloHostedRpc.Target, control: string, turn: ImageTurn, signal: AbortSignal) {
      if (!turn.agent || !turn.model) throw new HostedError("Select a Cloud agent and model to send an image.")
      const { batch, files } = select(turn.messageID, turn.attachments)
      const intent = JSON.stringify([target, turn.attachments, turn.text, turn.model, turn.agent, turn.variant])
      if (batch.intent && batch.intent !== intent)
        throw new HostedError("This attachment set was already submitted with another message.")
      batch.intent = intent
      const response = await web(
        "sendMessage",
        {
          cloudAgentSessionId: control,
          expectedWorktreeId: target.workspaceID,
          messageId: turn.messageID,
          payload: {
            type: "prompt",
            prompt: turn.text,
            mode: turn.agent,
            model: turn.model,
            ...(turn.variant && { variant: turn.variant }),
          },
          attachments: { path: batch.path, files: await Promise.all(files) },
        },
        signal,
      )
      if (
        !Schema.is(Ack)(response) ||
        response.cloudAgentSessionId !== control ||
        response.messageId !== turn.messageID
      )
        return invalid()
    },
  }
}
