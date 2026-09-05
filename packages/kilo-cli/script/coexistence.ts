import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Schema } from "effect"

if (process.argv.length !== 4) {
  throw new Error("Usage: bun script/coexistence.ts <stable-kilo-binary> <preview-kilo2-binary>")
}
const stableBinary = path.resolve(process.argv[2])
const previewBinary = path.resolve(process.argv[3])
const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-phase0-coexist-"))
const home = path.join(directory, "home")
const cwd = path.join(directory, "project")
const tmp = path.join(directory, "tmp")
const children: Bun.Subprocess<"ignore", "pipe", "pipe">[] = []

try {
  await Promise.all([home, cwd, tmp].map((value) => mkdir(value, { recursive: true })))
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_DATA_HOME: path.join(home, "data"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_STATE_HOME: path.join(home, "state"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    TERM: "dumb",
  }
  const stableDB = path.join(env.XDG_DATA_HOME, "kilo/kilo.db")
  const previewDB = path.join(env.XDG_DATA_HOME, "kilo2/preview/kilo2.db")
  const password = randomUUID()
  const stable = Bun.spawn([stableBinary, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd,
    env: {
      ...env,
      KILO_TEST_HOME: home,
      KILO_DB: stableDB,
      KILO_SERVER_USERNAME: "phase0",
      KILO_SERVER_PASSWORD: password,
      KILO_DISABLE_AUTOUPDATE: "true",
      KILO_DISABLE_MODELS_FETCH: "true",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 40_000,
  })
  children.push(stable)
  const stableErrors = new Response(stable.stderr).text()
  const url = await ready(stable.stdout, /kilo server listening on (http:\S+)/).catch(async (error) => {
    throw new Error(`Stable Kilo failed to start: ${String(error)}\n${await stableErrors}`)
  })
  const headers = {
    Authorization: `Basic ${btoa(`phase0:${password}`)}`,
    "Content-Type": "application/json",
    "x-kilo-directory": cwd,
  }
  const response = await fetch(`${url}/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Phase 0 stable sentinel" }),
  })
  if (!response.ok) throw new Error(`Stable session creation failed: ${response.status}`)
  const session = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String }))(
    await response.json(),
  )
  const before = await fingerprint(stableDB)
  const preview = Bun.spawn([previewBinary, "preview"], {
    cwd,
    env: { ...env, KILO_DB: stableDB, OPENCODE_DB: stableDB },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: 20_000,
  })
  children.push(preview)
  const errors = new Response(preview.stderr).text()
  await ready(preview.stdout, /(Kilo internal preview: ready)/)
  if (stable.exitCode !== null) throw new Error(`Stable exited unexpectedly: ${await stableErrors}`)
  using db = new Database(previewDB, { readonly: true })
  if (db.query("SELECT name FROM sqlite_master WHERE name = 'session'").get()) {
    throw new Error("Preview contains legacy sessions")
  }
  const count = db.query<{ count: number }, []>("SELECT count(*) AS count FROM session_v2").get()
  if (count?.count !== 0) throw new Error("Preview did not start empty")
  if (before !== (await fingerprint(stableDB))) throw new Error("Stable DB/sidecars changed during preview boot")
  const retained = await fetch(`${url}/session/${session.id}`, { headers })
  if (!retained.ok) throw new Error("Stable session is no longer readable")
  const info = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String }))(await retained.json())
  if (info.title !== session.title) throw new Error("Stable session was not preserved")
  preview.kill("SIGTERM")
  if ((await preview.exited) !== 0) throw new Error(`Preview shutdown failed: ${await errors}`)
  console.log(
    JSON.stringify({
      stableBinary,
      previewBinary,
      coexistence: "pass",
      twoStores: true,
      stableBytesPreserved: true,
      previewLegacyTable: false,
      previewSessions: count.count,
      previewShutdown: "pass",
    }),
  )
} finally {
  children.forEach((child) => child.kill("SIGTERM"))
  await Promise.all(children.map((child) => child.exited))
  await rm(directory, { recursive: true, force: true })
}

async function ready(stream: ReadableStream<Uint8Array>, pattern: RegExp) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) throw new Error(`Process closed before ready: ${chunks.join("")}`)
      chunks.push(decoder.decode(value.value, { stream: true }))
      const match = chunks.join("").match(pattern)
      if (match) return match[1]
    }
  } finally {
    reader.releaseLock()
  }
}

async function fingerprint(filename: string) {
  const result = []
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = Bun.file(filename + suffix)
    result.push(
      (await file.exists())
        ? createHash("sha256")
            .update(await file.bytes())
            .digest("hex")
        : "absent",
    )
  }
  return result.join(":")
}
