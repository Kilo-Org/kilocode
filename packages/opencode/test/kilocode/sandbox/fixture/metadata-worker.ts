import { existsSync, writeFileSync } from "node:fs"
import fs from "node:fs/promises"
import { eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import * as SandboxState from "@/kilocode/sandbox/state"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"

const input = JSON.parse(process.argv[2] ?? "{}") as {
  mode: "setup" | "sandbox" | "other" | "read"
  sessionID: string
  ready?: string
  start?: string
  count?: number
  read?: string
  done?: string
}
const id = SessionID.make(input.sessionID)

async function wait() {
  if (!input.ready || !input.start) return
  await fs.writeFile(input.ready, String(process.pid))
  while (!(await Bun.file(input.start).exists())) await Bun.sleep(5)
}

function wrap<T extends object>(target: T): T {
  return new Proxy(target, {
    get(value, property) {
      const member = Reflect.get(value, property)
      if (typeof member !== "function") return member
      if (property === "get") {
        return (...args: unknown[]) => {
          const result = Reflect.apply(member, value, args)
          if (!input.read || !input.done) return result
          writeFileSync(input.read, String(process.pid))
          const cell = new Int32Array(new SharedArrayBuffer(4))
          const timeout = Date.now() + 10_000
          while (!existsSync(input.done)) {
            if (Date.now() >= timeout) throw new Error(`Timed out waiting for ${input.done}`)
            Atomics.wait(cell, 0, 0, 10)
          }
          return result
        }
      }
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, value, args)
        return result && typeof result === "object" ? wrap(result) : result
      }
    },
  })
}

if (input.mode === "setup") {
  Database.use((db) => {
    const projectID = ProjectID.make("sandbox-metadata-process")
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        sandboxes: [],
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
    db.insert(SessionTable)
      .values({
        id,
        project_id: projectID,
        slug: "sandbox-metadata-process",
        directory: process.cwd(),
        title: "sandbox metadata process",
        version: "test",
        metadata: { other: {} },
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run()
  })
}

if (input.mode === "sandbox") {
  if (input.read && input.done) {
    Database.use((db) => {
      const target = db as unknown as { select: (...args: unknown[]) => object }
      const select = target.select.bind(db)
      target.select = (...args) => wrap(select(...args))
    })
  }
  await wait()
  for (const index of Array.from({ length: input.count ?? 0 }, (_, index) => index)) {
    await SandboxState.write(id, { enabled: index % 2 === 0, version: index }).pipe(Effect.runPromise)
  }
}

if (input.mode === "other") {
  await wait()
  if (input.read) {
    const timeout = Date.now() + 500
    while (!(await Bun.file(input.read).exists()) && Date.now() < timeout) await Bun.sleep(5)
  }
  for (const index of Array.from({ length: input.count ?? 0 }, (_, index) => index)) {
    const path = `$."other"."${index}"`
    Database.use((db) =>
      db
        .update(SessionTable)
        .set({ metadata: sql`json_set(${SessionTable.metadata}, ${path}, json('true'))` })
        .where(eq(SessionTable.id, id))
        .run(),
    )
  }
  if (input.done) await fs.writeFile(input.done, String(process.pid))
}

if (input.mode === "read") {
  const row = Database.use((db) =>
    db.select({ metadata: SessionTable.metadata }).from(SessionTable).where(eq(SessionTable.id, id)).get(),
  )
  process.stdout.write(JSON.stringify(row?.metadata))
}
