import fs from "fs/promises"
import path from "path"
import z from "zod"

const Auth = z.object({
  type: z.literal("oauth"),
  refresh: z.string(),
  access: z.string(),
  expires: z.number(),
  accountId: z.string().optional(),
})
type Auth = z.infer<typeof Auth>

const Tokens = z.object({
  id_token: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().optional(),
})

const Msg = z.object({
  root: z.string(),
  url: z.string(),
  ready: z.string(),
  start: z.string(),
  lock: z
    .object({
      staleMs: z.number(),
      timeoutMs: z.number(),
      baseDelayMs: z.number(),
      maxDelayMs: z.number(),
    })
    .optional(),
})

function input() {
  const raw = process.argv[2]
  if (!raw) throw new Error("Missing Codex auth refresh worker input")
  return Msg.parse(JSON.parse(raw))
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function wait(file: string) {
  const stop = Date.now() + 10_000
  while (Date.now() < stop) {
    if (
      await fs
        .stat(file)
        .then(() => true)
        .catch(() => false)
    )
      return
    await sleep(10)
  }
  throw new Error(`Timed out waiting for file: ${file}`)
}

async function main() {
  const msg = input()
  process.env.XDG_DATA_HOME = path.join(msg.root, "share")
  process.env.XDG_CACHE_HOME = path.join(msg.root, "cache")
  process.env.XDG_CONFIG_HOME = path.join(msg.root, "config")
  process.env.XDG_STATE_HOME = path.join(msg.root, "state")
  process.env.KILO_TEST_HOME = path.join(msg.root, "home")

  const { Path } = await import("@opencode-ai/core/global")
  const { refreshCodexAuth } = await import("../../../src/kilocode/provider/codex-refresh")
  const file = path.join(Path.data, "auth.json")
  const read = async () => {
    const data = z.object({ openai: Auth }).parse(JSON.parse(await fs.readFile(file, "utf8")))
    return data.openai
  }
  const plugin = {
    client: {
      auth: {
        set: async (req: { body: Auth }) => {
          await fs.writeFile(file, JSON.stringify({ openai: req.body }))
        },
      },
    },
  }

  await fs.writeFile(msg.ready, String(process.pid))
  await wait(msg.start)
  const auth = await read()
  const next = await refreshCodexAuth({
    input: plugin,
    getAuth: read,
    auth,
    refresh: async (token) => {
      const response = await fetch(msg.url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ refresh_token: token }).toString(),
      })
      if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)
      return Tokens.parse(await response.json())
    },
    account: () => undefined,
    lock: msg.lock,
  })

  process.stdout.write(JSON.stringify(next))
}

await main().catch((err) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(text)
  process.exit(1)
})
