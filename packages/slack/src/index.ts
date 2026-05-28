import { App } from "@slack/bolt"
import { createKilo, type ToolPart } from "@kilocode/sdk"

const token = process.env.SLACK_BOT_TOKEN!

const app = new App({
  token,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

console.log("🔧 Bot configuration:")
console.log("- Bot token present:", !!process.env.SLACK_BOT_TOKEN)
console.log("- Signing secret present:", !!process.env.SLACK_SIGNING_SECRET)
console.log("- App token present:", !!process.env.SLACK_APP_TOKEN)

console.log("🚀 Starting kilo server...")
const opencode = await createKilo({
  port: 0,
})
console.log("✅ Kilo server ready")

const sessions = new Map<string, { client: any; server: any; sessionId: string; channel: string; thread: string }>()
;(async () => {
  const events = await opencode.client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.type === "tool") {
        for (const [, session] of sessions.entries()) {
          if (session.sessionId === part.sessionID) {
            handleToolUpdate(part, session.channel, session.thread)
            break
          }
        }
      }
    }
  }
})()

async function handleToolUpdate(part: ToolPart, channel: string, thread: string) {
  if (part.state.status !== "completed") return
  const msg = `*${part.tool}* - ${part.state.title}`
  await app.client.chat
    .postMessage({
      channel,
      thread_ts: thread,
      text: msg,
    })
    .catch(() => {})
}

// Normalize a Slack file's MIME type to one supported by the Cloud Agent.
// Images and PDFs are forwarded as binary media; text-based formats are
// normalized to text/plain so the agent receives their decoded content.
// Returns null for unsupported types.
function normalizeMime(mime: string): string | null {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return mime
  if (mime === "application/pdf") return mime
  if (mime.startsWith("text/")) return "text/plain"
  return null
}

// Download a private Slack file using the bot token for authorization.
async function downloadFile(url: string): Promise<Uint8Array | null> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) {
    console.error("Failed to download Slack file:", resp.status, url)
    return null
  }
  return new Uint8Array(await resp.arrayBuffer())
}

type FilePart = { type: "file"; mime: string; filename?: string; url: string }

// Convert Slack file objects to FilePartInput items for the Cloud Agent.
// Downloads each file and encodes it as a base64 data URL.
// Skips unsupported MIME types, files that fail to download, and limits
// forwarding to 5 files to match the Cloud Agent's attachment limits.
async function buildFileParts(files: any[]): Promise<FilePart[]> {
  const parts: FilePart[] = []
  for (const file of files.slice(0, 5)) {
    const mime = normalizeMime(file.mimetype ?? "")
    if (!mime) continue
    const src = file.url_private_download ?? file.url_private
    if (!src) continue
    const data = await downloadFile(src)
    if (!data) continue
    const base64 = Buffer.from(data).toString("base64")
    parts.push({ type: "file", mime, filename: file.name ?? file.title, url: `data:${mime};base64,${base64}` })
  }
  return parts
}

app.use(async ({ next, context }) => {
  console.log("📡 Raw Slack event:", JSON.stringify(context, null, 2))
  await next()
})

app.message(async ({ message, say }) => {
  console.log("📨 Received message event:", JSON.stringify(message, null, 2))

  // Allow file_share subtype (user uploaded a file); skip all other subtypes.
  if (message.subtype && message.subtype !== "file_share") {
    console.log("⏭️ Skipping message - unsupported subtype:", message.subtype)
    return
  }

  const text = "text" in message ? message.text : undefined
  const files: any[] = "files" in message && Array.isArray((message as any).files) ? (message as any).files : []

  if (!text && files.length === 0) {
    console.log("⏭️ Skipping message - no text and no files")
    return
  }

  console.log("✅ Processing message:", text, `(${files.length} file(s))`)

  const channel = message.channel
  const thread = (message as any).thread_ts || message.ts
  const key = `${channel}-${thread}`

  let session = sessions.get(key)

  if (!session) {
    console.log("🆕 Creating new opencode session...")
    const { client, server } = opencode

    const createResult = await client.session.create({
      body: { title: `Slack thread ${thread}` },
    })

    if (createResult.error) {
      console.error("❌ Failed to create session:", createResult.error)
      await say({ text: "Sorry, I had trouble creating a session. Please try again.", thread_ts: thread })
      return
    }

    console.log("✅ Created opencode session:", createResult.data.id)

    session = { client, server, sessionId: createResult.data.id, channel, thread }
    sessions.set(key, session)

    const shareResult = await client.session.share({ path: { id: createResult.data.id } })
    if (!shareResult.error && shareResult.data) {
      const sessionUrl = shareResult.data.share?.url!
      console.log("🔗 Session shared:", sessionUrl)
      await app.client.chat.postMessage({ channel, thread_ts: thread, text: sessionUrl })
    }
  }

  // Build prompt parts: text first, then file attachments.
  // File parts are only forwarded when spawning a Cloud Agent session
  // (i.e. when a session exists or is being created above).
  const fileParts = await buildFileParts(files)
  const parts = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...fileParts,
  ]

  if (parts.length === 0) {
    console.log("⏭️ No parts to send after processing")
    return
  }

  console.log("📝 Sending to opencode:", text, `(${fileParts.length} attachment(s))`)
  const result = await session.client.session.prompt({
    path: { id: session.sessionId },
    body: { parts },
  })

  console.log("📤 Opencode response:", JSON.stringify(result, null, 2))

  if (result.error) {
    console.error("❌ Failed to send message:", result.error)
    await say({ text: "Sorry, I had trouble processing your message. Please try again.", thread_ts: thread })
    return
  }

  const response = result.data
  const responseText =
    response.info?.content ||
    response.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") ||
    "I received your message but didn't have a response."

  console.log("💬 Sending response:", responseText)
  await say({ text: responseText, thread_ts: thread })
})

app.command("/test", async ({ command, ack, say }) => {
  await ack()
  console.log("🧪 Test command received:", JSON.stringify(command, null, 2))
  await say("🤖 Bot is working! I can hear you loud and clear.")
})

await app.start()
console.log("⚡️ Slack bot is running!")
