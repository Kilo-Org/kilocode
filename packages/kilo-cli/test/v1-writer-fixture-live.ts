import { afterEach, expect, test } from "bun:test"
import { createReadStream, existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { V1Migration } from "@opencode-ai/core/database/v1-migration"
import { Global } from "@opencode-ai/util/global"
import { Effect } from "effect"
import { copyV1Store, inspectV1Source } from "../src/import-v1-session"

type Manifest = {
  readonly sessionID: string
  readonly userID: string
  readonly assistantID: string
  readonly compactionID: string
  readonly summaryID: string
}

type SourceMessage = {
  readonly id: string
  readonly time_created: number
  readonly time_updated: number
  readonly data: string
}

type SourcePart = {
  readonly id: string
  readonly message_id: string
  readonly data: string
}

type SourceSession = {
  readonly summary_diffs: string | null
  readonly cost: number
}

type MigratedSession = {
  readonly summary_diffs: string | null
  readonly cost: number
  readonly tokens_input: number
  readonly tokens_output: number
  readonly tokens_reasoning: number
  readonly tokens_cache_read: number
  readonly tokens_cache_write: number
}

type MigratedMessage = {
  readonly id: string
  readonly type: string
  readonly seq: number
  readonly time_created: number
  readonly time_updated: number
  readonly data: string
}

const v1Checkout = process.env.KILOCODE_V1_CHECKOUT
if (!v1Checkout) throw new Error("KILOCODE_V1_CHECKOUT is required for the explicit live writer roundtrip")
const v1WriterChild = path.join(import.meta.dir, "v1-writer-fixture-child.ts")
const cleanups: string[] = []

test("imports a real Kilo-main V1 writer fixture through the V2 migration copy", async () => {
  const required = [
    path.join(v1Checkout, "packages/opencode/src/session/session.ts"),
    path.join(v1Checkout, "packages/opencode/node_modules/effect/dist/index.js"),
  ]
  const missing = required.filter((filename) => !existsSync(filename))
  if (missing.length > 0)
    throw new Error(`Kilo-main writer fixture requires checkout ${v1Checkout}; missing ${missing.join(", ")}`)

  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-v1-writer-fixture-"))
  cleanups.push(root)
  const sourceDirectory = path.join(root, "source")
  const destinationDirectory = path.join(root, "destination")
  const source = path.join(sourceDirectory, "kilo.db")
  const destination = path.join(destinationDirectory, "kilo2.db")
  const projectDirectory = path.join(root, "project")
  const manifestPath = path.join(root, "manifest.json")
  await Promise.all([sourceDirectory, destinationDirectory, projectDirectory].map((directory) => mkdir(directory)))

  const child = Bun.spawn([process.execPath, "--no-env-file", v1WriterChild], {
    cwd: path.join(v1Checkout, "packages/opencode"),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: path.join(root, "home"),
      USERPROFILE: path.join(root, "home"),
      TMPDIR: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      TEMP: path.join(root, "tmp"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
      OPENCODE_TEST_HOME: path.join(root, "home"),
      KILO_DB: source,
      KILO_DISABLE_CHANNEL_DB: "1",
      KILO_DISABLE_DEFAULT_PLUGINS: "1",
      KILOCODE_V1_CHECKOUT: v1Checkout,
      KILO_V1_FIXTURE_PROJECT: projectDirectory,
      KILO_V1_FIXTURE_MANIFEST: manifestPath,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Kilo-main writer exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)

  const manifest = JSON.parse(await Bun.file(manifestPath).text()) as Manifest
  const beforeHashes = await contentHashes(source)
  const sourceInspection = await inspectV1Source(source)
  expect(sourceInspection.sessions).toBe(1)
  expect(sourceInspection.messages).toBe(4)
  expect(sourceInspection.parts).toBe(6)

  const sqlite = await import("bun:sqlite")
  {
    using db = new sqlite.Database(source, { readonly: true, strict: true })
    const sourceSession = db
      .query<SourceSession, [string]>("SELECT summary_diffs, cost FROM session WHERE id = ?")
      .get(manifest.sessionID)
    expect(sourceSession).toBeDefined()
    expect(sourceSession?.summary_diffs).toBeString()
    expect(JSON.parse(sourceSession?.summary_diffs ?? "null")).toEqual([
      {
        file: "fixture.ts",
        patch: "@@ -0,0 +1 @@\n+fixture\n",
        before: "",
        after: "fixture\n",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
    ])

    const sourceMessages = db
      .query<
        SourceMessage,
        [string]
      >("SELECT id, time_created, time_updated, data FROM message WHERE session_id = ? ORDER BY time_created, id")
      .all(manifest.sessionID)
    expect(sourceMessages.map((message) => message.id)).toEqual([
      manifest.userID,
      manifest.assistantID,
      manifest.compactionID,
      manifest.summaryID,
    ])
    const sourceUser = JSON.parse(sourceMessages[0].data) as Record<string, unknown>
    expect(sourceUser).toMatchObject({
      role: "user",
      system: "fixture system context",
      tools: { bash: true },
      editorContext: { activeFile: "fixture.ts", shell: "zsh" },
      summary: { diffs: [{ additions: 1, deletions: 0 }] },
    })
    const sourceAssistant = JSON.parse(sourceMessages[1].data) as Record<string, unknown>
    expect(sourceAssistant).toMatchObject({
      role: "assistant",
      structured: { fixture: true },
      variant: "fixture-variant",
      finish: "end_turn",
    })

    const sourceParts = db
      .query<SourcePart, [string]>("SELECT id, message_id, data FROM part WHERE session_id = ?")
      .all(manifest.sessionID)
    const sourcePartByID = new Map(sourceParts.map((part) => [part.id, part]))
    expect(JSON.parse(sourcePartByID.get("prt_fixture_tool")?.data ?? "null")).toMatchObject({
      type: "tool",
      tool: "bash",
      state: { status: "completed", output: "fixture\n", input: { command: "printf fixture" } },
    })
    expect(JSON.parse(sourcePartByID.get("prt_fixture_step_finish")?.data ?? "null")).toMatchObject({
      type: "step-finish",
      generationID: "generation_fixture",
      vercelID: "vercel_fixture",
      metrics: { prompt: 101, generation: 202, source: "provider" },
    })
  }

  const copied = await copyV1Store({ source, destination })
  expect(copied.source.sessions).toBe(1)
  expect(copied.source.messages).toBe(4)
  expect(copied.source.parts).toBe(6)
  expect(copied.source.sha256).toBe((await contentHashes(source))[0].sha256)

  await mkdir(path.join(root, "v2-global"), { recursive: true })
  const globalRoot = path.join(root, "v2-global")
  const migration = await Effect.runPromise(
    Effect.scoped(
      V1Migration.run().pipe(
        Effect.provide(Database.layer({ path: destination })),
        Effect.provide(
          Global.layerWith({
            home: path.join(globalRoot, "home"),
            data: path.join(globalRoot, "data"),
            config: path.join(globalRoot, "config"),
            cache: path.join(globalRoot, "cache"),
            state: path.join(globalRoot, "state"),
            tmp: path.join(globalRoot, "tmp"),
            log: path.join(globalRoot, "log"),
            bin: path.join(globalRoot, "bin"),
            repos: path.join(globalRoot, "repos"),
          }),
        ),
      ),
    ),
  )
  expect(migration).toEqual({ status: "completed" })
  expect(await contentHashes(source)).toEqual(beforeHashes)

  {
    using db = new sqlite.Database(destination, { readonly: true, strict: true })
    const migratedSession = db
      .query<MigratedSession, [string]>(
        `SELECT summary_diffs, cost, tokens_input, tokens_output, tokens_reasoning,
                tokens_cache_read, tokens_cache_write FROM session_v2 WHERE id = ?`,
      )
      .get(manifest.sessionID)
    expect(migratedSession).toBeDefined()
    expect(migratedSession).toMatchObject({
      cost: 0.75,
      tokens_input: 3,
      tokens_output: 5,
      tokens_reasoning: 5,
      tokens_cache_read: 7,
      tokens_cache_write: 7,
    })
    expect(JSON.parse(migratedSession?.summary_diffs ?? "null")).toEqual([
      {
        file: "fixture.ts",
        patch: "@@ -0,0 +1 @@\n+fixture\n",
        before: "",
        after: "fixture\n",
        additions: 1,
        deletions: 0,
        status: "modified",
      },
    ])

    const migratedMessages = db
      .query<
        MigratedMessage,
        [string]
      >("SELECT id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq")
      .all(manifest.sessionID)
    expect(migratedMessages.map((message) => message.id)).toEqual([
      manifest.userID,
      manifest.assistantID,
      manifest.compactionID,
    ])
    expect(migratedMessages.map((message) => message.type)).toEqual(["user", "assistant", "compaction"])
    expect(migratedMessages.map((message) => message.seq)).toEqual([0, 1, 2])

    const migratedUser = JSON.parse(migratedMessages[0].data) as Record<string, unknown>
    expect(migratedUser).toMatchObject({ text: "hello from the actual V1 writer", time: { created: 10 } })
    expect(migratedUser).not.toHaveProperty("editorContext")
    expect(migratedUser).not.toHaveProperty("summary")
    expect(migratedUser).not.toHaveProperty("system")

    const migratedAssistant = JSON.parse(migratedMessages[1].data) as Record<string, unknown>
    expect(migratedAssistant).toMatchObject({
      agent: "build",
      model: { providerID: "fixture-provider", id: "fixture-model", variant: "fixture-variant" },
      finish: "unknown",
      cost: 0.5,
      tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
      time: { created: 20 },
    })
    expect(migratedAssistant).not.toHaveProperty("structured")
    const migratedContent = migratedAssistant.content as Array<Record<string, unknown>>
    expect(migratedContent).toContainEqual({ type: "text", text: "assistant response from the actual V1 writer" })
    expect(migratedContent.find((content) => content.type === "tool")).toMatchObject({
      id: "call_fixture",
      name: "bash",
      state: {
        status: "completed",
        input: { command: "printf fixture", description: "fixture command" },
        content: [{ type: "text", text: "fixture\n" }],
      },
    })

    const migratedCompaction = JSON.parse(migratedMessages[2].data) as Record<string, unknown>
    expect(migratedCompaction).toMatchObject({
      status: "completed",
      reason: "auto",
      summary: "compaction summary from the actual V1 writer",
      time: { created: 30 },
    })
    expect(migratedCompaction.recent).toContain("hello from the actual V1 writer")
    expect(migratedMessages.some((message) => message.id === manifest.summaryID)).toBe(false)
    expect(db.query("SELECT COUNT(*) AS count FROM event").get()).toEqual({ count: 0 })
  }
}, 180_000)

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true })
})

async function contentHashes(filename: string) {
  return Promise.all(
    [filename, `${filename}-wal`].map(async (candidate) => ({
      path: candidate,
      sha256: await digest(candidate),
    })),
  )
}

async function digest(filename: string) {
  if (!existsSync(filename)) return ""
  const hasher = new Bun.CryptoHasher("sha256")
  for await (const chunk of createReadStream(filename)) hasher.update(chunk)
  return hasher.digest("hex")
}
