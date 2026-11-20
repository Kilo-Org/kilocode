// A load rehearsal cannot accept an existing store or profile, even through environment overrides.
import { Database } from "bun:sqlite"
import { randomBytes } from "node:crypto"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import { statSync, statfsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const sessions = Number(process.argv[2] ?? 8)
if (!Number.isInteger(sessions) || sessions < 1 || sessions > 1024)
  throw new Error("Expected 1–1024 synthetic sessions")
const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), "cutover-fixture-")))
try {
  const dir = path.join(profile, "data/kilo")
  await mkdir(path.join(profile, ".git"))
  const source = path.join(dir, "kilo.db")
  const backup = `${source}.pre-v2`
  for (const name of [dir, path.join(profile, "home"), path.join(profile, "tmp")])
    await mkdir(name, { recursive: true })
  {
    using db = new Database(source)
    db.exec(await Bun.file(path.join(import.meta.dir, "../test/fixture/kilo-v1-schema.sql")).text())
    db.run("INSERT INTO project(id,worktree,time_created,time_updated,sandboxes) VALUES('global','/',1,1,'[]')")
    db.transaction(() => {
      for (let i = 0; i < sessions; i++) {
        const session = `ses_fixture${i}`,
          message = `msg_fixture${i}`
        db.run(
          "INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated) VALUES (?,'global','fixture',?,'Synthetic fixture','7',1,2)",
          [session, profile],
        )
        db.run("INSERT INTO message VALUES(?,?,1,1,?)", [
          message,
          session,
          JSON.stringify({
            role: "user",
            time: { created: 1 },
            agent: "code",
            model: { providerID: "kilo", modelID: "kilo-auto/free" },
          }),
        ])
        db.run("INSERT INTO part VALUES(?,?,?,1,1,?)", [
          `prt_fixture${i}`,
          message,
          session,
          JSON.stringify({ type: "text", text: randomBytes(512 * 1024).toString("hex") }),
        ])
      }
    })()
  }
  const sourceBytes = statSync(source).size
  const available = () => {
    const fs = statfsSync(profile)
    return fs.bavail * fs.bsize
  }
  const baseline = available()
  let minimum = baseline
  const sample = setInterval(() => {
    minimum = Math.min(minimum, available())
  }, 200)
  const started = performance.now()
  try {
    const proc = Bun.spawn([process.execPath, "dev", "migrate", "apply", "--accept-jetbrains-breakage"], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        HOME: path.join(profile, "home"),
        USERPROFILE: path.join(profile, "home"),
        TMPDIR: path.join(profile, "tmp"),
        KILO_V2_PROFILE: profile,
        INIT_CWD: profile,
        KILO_INTERNAL_PROFILE_CUTOVER: "1",
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    })
    if ((await proc.exited) !== 0) throw new Error("Cutover failed on synthetic fixture")
  } finally {
    clearInterval(sample)
  }
  using active = new Database(source, { readonly: true })
  using recovery = new Database(backup, { readonly: true })
  const count = (db: Database, table: "session" | "session_v2" | "session_message") =>
    db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n
  const migrated = count(active, "session_v2"),
    recovered = count(recovery, "session"),
    messages = count(active, "session_message")
  if ([migrated, recovered, messages].some((n) => n !== sessions))
    throw new Error(`Verification failed: ${migrated}/${recovered}/${messages}`)
  console.log(
    JSON.stringify({
      sourceBytes,
      sessions: migrated,
      messages,
      recoverableSessions: recovered,
      elapsedSeconds: (performance.now() - started) / 1000,
      convertedBytes: statSync(source).size,
      backupBytes: statSync(backup).size,
      observedVolumeSpaceDropBytes: baseline - minimum,
    }),
  )
} finally {
  await rm(profile, { recursive: true, force: true })
}
